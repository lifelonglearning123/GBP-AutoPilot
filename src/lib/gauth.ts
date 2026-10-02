import { all, one, run, getSetting, setSetting, log } from './db';
import { ukParts } from './uktime';

/**
 * Google OAuth for the single agency account.
 *
 * Consent screen setup, in order of preference:
 *  - "Internal" (Google Workspace only): no warning screen, no user cap, no verification.
 *  - "External" with publishing status **In production**: what a non-Workspace account gets. The
 *    unverified-app warning appears once per authorisation and is clicked through; refresh tokens
 *    persist. The 100-user cap does not matter because only the agency account ever authorises.
 *
 * What must NOT happen is External left in "Testing": Google expires refresh tokens after 7 days
 * there, so the scheduler dies mid-week with invalid_grant and no other symptom.
 */
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOKE = 'https://oauth2.googleapis.com/revoke';

export const SCOPES = [
  'https://www.googleapis.com/auth/business.manage',
  'https://www.googleapis.com/auth/userinfo.email',
];

const EXPIRY_SKEW_MS = 60_000;
export const STATE_COOKIE = 'gbp_oauth_state';

export function clientId() { return process.env.GOOGLE_CLIENT_ID?.trim() ?? ''; }
export function clientSecret() { return process.env.GOOGLE_CLIENT_SECRET?.trim() ?? ''; }
export function redirectUri(): string {
  return process.env.OAUTH_REDIRECT_URI?.trim() || 'http://localhost:3320/api/auth/google/callback';
}
export function hasOAuthConfig(): boolean { return Boolean(clientId() && clientSecret()); }

/**
 * A Google account the app has been given, with the refresh token that keeps it.
 *
 * There can be several. Business Profiles are owned per Google account, and one account's token
 * cannot read another's locations, so somebody managing profiles under two sign-ins has to connect
 * both. `login` is the email, because that is what a person recognises in a list.
 */
export type Connection = {
  login: string;
  email: string | null;
  name: string | null;
  refresh_token: string;
  access_token: string | null;
  expires_at: number;
  scope: string | null;
  connected_at: string;
};

/** Every connected Google account, oldest first so the list never reshuffles itself. */
export function listConnections(): Connection[] {
  return all<any>('SELECT * FROM google_logins ORDER BY connected_at, login')
    .map(r => ({ ...r, email: r.name ?? (r.login.includes('@') ? r.login : null) }));
}

/** The first connection: for "is Google connected at all?" and for calls that name no account. */
export function getConnection(): Connection | undefined {
  return listConnections()[0];
}
export function isConnected(): boolean { return listConnections().length > 0; }

/** One connection by login, for a call that belongs to a particular account. */
export function connection(login: string): Connection | undefined {
  return listConnections().find(c => c.login === login);
}

/** Forget one Google account, or all of them, revoking each token with Google as it goes. */
export function disconnect(login?: string) {
  const going = login ? listConnections().filter(c => c.login === login) : listConnections();
  for (const c of going) {
    run('DELETE FROM google_logins WHERE login = ?', c.login);
    // The old one-row table holds a copy of the FIRST account ever connected, and db.ts copies it
    // back into google_logins at every start. It used to be cleared only when no login was left,
    // so disconnecting the first account while a second stayed brought the first back, revoked
    // token and all, at the next restart.
    run(`DELETE FROM google_connection WHERE id = 1 AND lower(coalesce(email, 'default')) = lower(?)`, c.login);
    fetch(`${REVOKE}?token=${encodeURIComponent(c.refresh_token)}`, { method: 'POST' }).catch(() => {});
  }
  // The old single-row table is kept in step so a downgrade cannot resurrect a revoked token.
  if (!login || listConnections().length === 0) run('DELETE FROM google_connection WHERE id = 1');
}

export function authUrl(state: string): string {
  const qs = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES.join(' '),
    // offline + consent are what actually produce a refresh token on every connect.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH}?${qs}`;
}

async function tokenRequest(body: Record<string, string>): Promise<any> {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json?.error_description || json?.error || res.statusText;
    if (json?.error === 'invalid_grant') {
      throw new Error(
        'Google rejected the saved authorisation (invalid_grant): the refresh token expired or was revoked. ' +
        'Reconnect on the Settings page. If this keeps happening about a week after each reconnect, the OAuth ' +
        'consent screen is still in "Testing" — publish it to "In production" (Google Auth Platform > Audience), ' +
        'which stops the 7-day refresh-token expiry.'
      );
    }
    throw new Error(`Google OAuth: ${detail}`);
  }
  return json;
}

export async function exchangeCode(code: string): Promise<Connection> {
  const tok = await tokenRequest({
    code, client_id: clientId(), client_secret: clientSecret(), redirect_uri: redirectUri(), grant_type: 'authorization_code',
  });
  if (!tok.refresh_token) {
    throw new Error('Google returned no refresh token. Remove the app at myaccount.google.com/permissions and connect again.');
  }
  const expiresAt = Date.now() + Number(tok.expires_in ?? 3600) * 1000;

  let email: string | null = null;
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${tok.access_token}` } });
    const j: any = await r.json();
    email = j?.email ?? null;
  } catch { /* nicety only */ }

  // Keyed by the account's own email, so connecting a second Google account ADDS a login and
  // reconnecting the same one refreshes it in place.
  const login = (email ?? 'default').toLowerCase();
  run(
    `INSERT INTO google_logins (login, name, refresh_token, access_token, expires_at, scope, connected_at)
     VALUES (?,?,?,?,?,?, datetime('now'))
     ON CONFLICT(login) DO UPDATE SET name = excluded.name, refresh_token = excluded.refresh_token,
       access_token = excluded.access_token, expires_at = excluded.expires_at, scope = excluded.scope,
       connected_at = datetime('now')`,
    login, email, tok.refresh_token, tok.access_token, expiresAt, String(tok.scope ?? '')
  );
  return connection(login)!;
}

// ---------- Pipedream: borrowed Google access while our own API access request is reviewed ----------

/**
 * Google gives a Cloud project ZERO Business Profile API quota until it approves the project's
 * access request. Pipedream's Google app is already approved, so until ours is, the app borrows it:
 * Chao connects his Google account in a Pipedream workflow (pipedream/google-token.mjs) and the app
 * fetches that account's short-lived access token over HTTPS, guarded by a shared secret. Every call
 * then counts against Pipedream's Google quota. Remove PIPEDREAM_TOKEN_URL to switch back to the
 * app's own OAuth connection, which stays saved.
 *
 * The token is cached in memory until a minute before it expires, so the workflow runs about once
 * an hour at most (each run uses Pipedream credits).
 */
export function pipedreamUrl(): string { return process.env.PIPEDREAM_TOKEN_URL?.trim() ?? ''; }
function pipedreamSecret(): string { return process.env.PIPEDREAM_TOKEN_SECRET?.trim() ?? ''; }
export function viaPipedream(): boolean { return Boolean(pipedreamUrl() && pipedreamSecret()); }
/** Secret set but no URL yet: the workflow is not deployed or its URL not pasted in. */
export function pipedreamHalfSet(): boolean { return Boolean(pipedreamSecret() && !pipedreamUrl()); }

/**
 * One token per Google login connected in Pipedream. The Pipedream endpoint returns them all in one
 * run, so adding a login costs no extra credits. `login` is the Pipedream account id (apn_...).
 */
export type BorrowedToken = { login: string; name: string | null; token: string; expiresAt: number; email: string | null; scope: string | null; fetchedAt: number };
const borrowed = globalThis as unknown as { __gbpPdTokens?: BorrowedToken[]; __gbpPdPending?: Promise<BorrowedToken[]> };
const TOKEN_KEY = 'pipedream_token';
const COUNT_KEY = 'pipedream_fetches';
const LOGINS_KEY = 'google_account_logins';

/** Stored tokens. An older single-token entry reads as one login called "default". */
function storedTokens(): BorrowedToken[] {
  try {
    const v = JSON.parse(getSetting(TOKEN_KEY) ?? 'null');
    if (Array.isArray(v)) return v;
    if (v?.token) return [{ login: 'default', name: null, ...v }];
  } catch { /* none stored */ }
  return [];
}

/** Every login's token, from memory or the settings table, while all are valid. They are refreshed together. */
function cachedTokens(): BorrowedToken[] | undefined {
  const fresh = (ts?: BorrowedToken[]) => Boolean(ts?.length && ts.every(t => t.token && t.expiresAt > Date.now() + EXPIRY_SKEW_MS));
  if (fresh(borrowed.__gbpPdTokens)) return borrowed.__gbpPdTokens;
  const ts = storedTokens();
  if (fresh(ts)) return (borrowed.__gbpPdTokens = ts);
  return undefined;
}

/** For the Settings page: when the tokens were fetched and for which logins. Never the tokens themselves. */
export function borrowedToken(): { fetchedAt: number; expiresAt: number; logins: { login: string; name: string | null; email: string | null }[] } | undefined {
  const ts = borrowed.__gbpPdTokens ?? storedTokens();
  if (!ts.length) return undefined;
  return {
    fetchedAt: Math.min(...ts.map(t => t.fetchedAt)),
    expiresAt: Math.min(...ts.map(t => t.expiresAt)),
    logins: ts.map(t => ({ login: t.login, name: t.name, email: t.email })),
  };
}
export function dropBorrowedToken() {
  borrowed.__gbpPdTokens = undefined;
  setSetting(TOKEN_KEY, 'null');
}

function accountLogins(): Record<string, string> {
  try { return JSON.parse(getSetting(LOGINS_KEY) ?? '{}') ?? {}; } catch { return {}; }
}
/**
 * Forget mappings that point at a login we no longer hold.
 *
 * The map outlives the connections: switching from borrowed Pipedream tokens to our own accounts
 * leaves every entry naming a Pipedream login, and disconnecting an account leaves its own. A stale
 * entry is worse than none, because the token picker falls back to the first connection and Google
 * answers "Requested entity was not found" for a business that first account cannot see. Cleared,
 * the next listAccounts() learns the truth.
 */
export function pruneAccountLogins() {
  if (viaPipedream()) return;
  const mine = new Set(listConnections().map(c => c.login));
  const m = accountLogins();
  const kept = Object.fromEntries(Object.entries(m).filter(([, login]) => mine.has(login)));
  if (Object.keys(kept).length !== Object.keys(m).length) setSetting(LOGINS_KEY, JSON.stringify(kept));
}

/** Which Google login manages a Business Profile account (accounts/123). Learnt whenever accounts are listed. */
export function rememberAccountLogin(account: string, login: string) {
  const m = accountLogins();
  if (m[account] === login) return;
  m[account] = login;
  setSetting(LOGINS_KEY, JSON.stringify(m));
}
/** The login for a Google API URL or resource name: by its account, else by the account of its location. */
function loginFor(resource?: string): string | undefined {
  if (!resource) return undefined;
  const acc = /accounts\/\d+/.exec(resource)?.[0];
  const loc = /locations\/\d+/.exec(resource)?.[0];
  const account = acc ?? (loc ? one<{ account: string }>('SELECT account FROM locations WHERE id = ?', loc)?.account : undefined);
  return account ? accountLogins()[account] : undefined;
}

/** The Google logins the app can act as: every account connected in Pipedream, or every one of our own. */
export async function googleLogins(): Promise<{ login: string; name: string | null }[]> {
  if (viaPipedream()) return (await borrowTokens()).map(t => ({ login: t.login, name: t.name ?? t.email }));
  return listConnections().map(c => ({ login: c.login, name: c.email }));
}

/**
 * Pipedream's free plan allows 3 credits a day and every token fetch costs one, so the app counts
 * its fetches per UTC day (Pipedream's day) and stops before Pipedream does.
 */
export function pipedreamBudget(): { used: number; limit: number; resetsAt: string } {
  const limit = Math.max(1, Math.floor(Number(process.env.PIPEDREAM_DAILY_TOKENS) || 3));
  const day = new Date().toISOString().slice(0, 10);
  let used = 0;
  try {
    const c = JSON.parse(getSetting(COUNT_KEY) ?? 'null');
    if (c?.day === day) used = Number(c.n) || 0;
  } catch { /* fresh count */ }
  const next = new Date();
  next.setUTCHours(24, 0, 0, 0);
  return { used, limit, resetsAt: next.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) };
}
function countFetch(setTo?: number) {
  const { used } = pipedreamBudget();
  setSetting(COUNT_KEY, JSON.stringify({ day: new Date().toISOString().slice(0, 10), n: setTo ?? used + 1 }));
}

/** Local hours in which the scheduler may fetch a token for its Google jobs (reviews, posts, photos). */
export function pipedreamWindows(): number[] {
  const w = (process.env.PIPEDREAM_WINDOWS ?? '9,14').split(',').map(x => Number(x.trim()))
    .filter(h => Number.isInteger(h) && h >= 0 && h < 24);
  return w.length ? w : [9, 14];
}

async function fetchBorrowed(): Promise<BorrowedToken[]> {
  const b = pipedreamBudget();
  if (b.used >= b.limit) {
    throw new Error(`All ${b.limit} of today's Pipedream Google tokens are used (the free plan allows ${b.limit} a day). Google features come back at ${b.resetsAt}.`);
  }
  let res: Response;
  try {
    res = await fetch(pipedreamUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-autopilot-secret': pipedreamSecret() },
      body: '{}',
      cache: 'no-store',
    });
  } catch (e: any) {
    throw new Error(`Could not reach Pipedream (${e?.message ?? e}). Check PIPEDREAM_TOKEN_URL in .env.local.`);
  }
  countFetch();   // Pipedream ran the endpoint, so the credit is spent whatever it answered
  { const n = pipedreamBudget(); log('pipedream', res.ok ? 'ok' : 'error', `Google token fetched through Pipedream (HTTP ${res.status}): ${n.used} of ${n.limit} today`); }
  const j: any = await res.json().catch(() => ({}));
  if (res.status === 401) {
    throw new Error('Pipedream refused the secret. PIPEDREAM_TOKEN_SECRET in .env.local must match the secret the Pipedream endpoint was deployed with (run pipedream/deploy.mjs --replace).');
  }
  if (res.status === 429 || (!res.ok && /credit|quota|limit/i.test(JSON.stringify(j)))) {
    countFetch(b.limit);
    throw new Error(`Pipedream says today's credits are used up. Google features come back at ${b.resetsAt}.`);
  }
  const now = Date.now();
  const list: any[] = Array.isArray(j?.tokens) && j.tokens.length ? j.tokens : j?.access_token ? [{ id: 'default', label: null, ...j }] : [];
  const ts: BorrowedToken[] = list.filter(t => t?.access_token).map(t => ({
    login: String(t.id || 'default'),
    name: t.label ?? null,
    token: String(t.access_token),
    expiresAt: now + Math.max(120, Number(t.expires_in) || 1800) * 1000,
    email: t.email ?? null,
    scope: t.scope ?? null,
    fetchedAt: now,
  }));
  if (!res.ok || !ts.length) {
    throw new Error(
      `Pipedream returned no Google token (HTTP ${res.status}${j?.error ? `: ${j.error}` : ''}). ` +
      'Check in Pipedream that the endpoint is deployed and the Google Business Profile accounts are still connected.'
    );
  }
  borrowed.__gbpPdTokens = ts;
  setSetting(TOKEN_KEY, JSON.stringify(ts));
  return ts;
}

async function borrowTokens(): Promise<BorrowedToken[]> {
  const ts = cachedTokens();
  if (ts) return ts;
  // A sync fires many calls at once: let them share one trip to Pipedream.
  borrowed.__gbpPdPending ??= fetchBorrowed().finally(() => { borrowed.__gbpPdPending = undefined; });
  return borrowed.__gbpPdPending;
}

/**
 * May Google work run now? Always, on our own connection. Through Pipedream: yes while a token is
 * still valid; otherwise the scheduler only fetches one inside a window and never spends the last
 * token of the day, which is kept for things done by hand (sync, approving a reply).
 */
export async function googleReady(who: 'scheduler' | 'manual'): Promise<{ ok: boolean; why?: string }> {
  if (!viaPipedream() || cachedTokens()) return { ok: true };
  if (who === 'scheduler') {
    const w = pipedreamWindows();
    if (!w.includes(ukParts().hour)) {
      return { ok: false, why: `waiting for the next Pipedream window (${w.map(h => `${h}:00`).join(' and ')})` };
    }
    const b = pipedreamBudget();
    if (b.used >= b.limit - 1) {
      return { ok: false, why: `${b.used} of ${b.limit} Pipedream tokens used today, and the last one is kept for your own actions` };
    }
  }
  try { await borrowTokens(); return { ok: true }; } catch (e: any) { return { ok: false, why: e.message }; }
}

/**
 * A token for a Google call. Through Pipedream, the login is the one given, else the one that manages
 * the account or location the URL names, else the first.
 */
export async function accessToken(opts: { login?: string; resource?: string } = {}): Promise<string> {
  if (viaPipedream()) {
    const ts = await borrowTokens();
    const login = opts.login ?? loginFor(opts.resource);
    return (ts.find(t => t.login === login) ?? ts[0]).token;
  }
  // Our own connections: the account that manages what the URL names, else the first one.
  const want = opts.login ?? loginFor(opts.resource);
  const conns = listConnections();
  if (!conns.length) throw new Error('Google is not connected. Connect it on the Settings page.');
  const conn = (want ? conns.find(c => c.login === want) : undefined) ?? conns[0];
  if (conn.access_token && conn.expires_at > Date.now() + EXPIRY_SKEW_MS) return conn.access_token;

  const tok = await tokenRequest({
    refresh_token: conn.refresh_token, client_id: clientId(), client_secret: clientSecret(), grant_type: 'refresh_token',
  });
  const expiresAt = Date.now() + Number(tok.expires_in ?? 3600) * 1000;
  run('UPDATE google_logins SET access_token = ?, expires_at = ? WHERE login = ?', tok.access_token, expiresAt, conn.login);
  return tok.access_token as string;
}
