// Sets up the Pipedream side of GBP Autopilot's borrowed Google access, using a Pipedream API key.
//
//   node --use-system-ca pipedream/deploy.mjs            create (or reuse) the token source
//   node --use-system-ca pipedream/deploy.mjs --replace  delete the existing one and create it again
//
// Before running: sign up at pipedream.com, connect a Google Business Profile account there
// (Accounts > Connect an app, signing in as the account clients add as a manager), and put your
// Pipedream API key in .env.local as PIPEDREAM_API_KEY. The script then:
//   1. finds your workspace and every connected Google Business Profile login,
//   2. generates pipedream/google-token-source.mjs for those logins and deploys it as an HTTP
//      source with the shared secret, replacing the old one if the set of logins changed,
//   3. writes the source's URL into .env.local as PIPEDREAM_TOKEN_URL,
//   4. checks the URL returns a token and that Google accepts it.
// It never prints the API key, the secret or the Google token.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ENV = path.join(here, "..", ".env.local");
const API = "https://api.pipedream.com/v1";
const NAME = "gbp-autopilot-google-token";
const replace = process.argv.includes("--replace");

function fail(msg) { console.error(`\nStopped: ${msg}`); process.exit(1); }

// The connection to Pipedream is occasionally reset before TLS completes: retry network errors.
async function fetchRetry(url, init, tries = 5) {
  for (let i = 1; ; i++) {
    try { return await fetch(url, init); }
    catch (e) {
      if (i >= tries) throw new Error(`could not reach ${new URL(url).host} after ${tries} tries (${e.cause?.code ?? e.message})`);
      await new Promise(r => setTimeout(r, 1500 * i));
    }
  }
}

let env = fs.readFileSync(ENV, "utf8");
const get = k => new RegExp(`^${k}=(.*)$`, "m").exec(env)?.[1]?.trim() ?? "";
const secret = get("PIPEDREAM_TOKEN_SECRET");
if (secret.length < 32) fail("PIPEDREAM_TOKEN_SECRET is missing or too short in .env.local.");

// A personal API key (pipedream.com/user > API Key) is what Pipedream documents for creating
// sources. A workspace OAuth client (pipedream.com/settings/api) is tried when no key is set.
const apiKey = get("PIPEDREAM_API_KEY");
const clientId = get("PIPEDREAM_CLIENT_ID") || get("PIPEDREAM_TOKEN_CLIENT_ID");
const clientSecret = get("PIPEDREAM_CLIENT_SECRET") || get("PIPEDREAM_TOKEN_CLIENT_SECRET");
let bearer = apiKey;
const mode = apiKey ? "personal API key" : "workspace OAuth client";
if (!apiKey) {
  if (!clientId || !clientSecret) fail("add your personal Pipedream API key (pipedream.com/user, My Account, API Key) after PIPEDREAM_API_KEY= in .env.local, then run this again.");
  const r = await fetchRetry(`${API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) fail(`Pipedream refused the OAuth client (HTTP ${r.status} ${j.error ?? ""}). Check the client ID and secret, or use a personal API key instead.`);
  bearer = j.access_token;
}
console.log(`Signing in to Pipedream with the ${mode}.`);

async function pd(method, p, body, soft = false) {
  const r = await fetchRetry(API + p, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let j; try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text.slice(0, 300) }; }
  if (!r.ok && !soft && !apiKey && (r.status === 401 || r.status === 403)) {
    fail(`${method} ${p.split("?")[0]} was refused with the OAuth client (HTTP ${r.status}). ${needKey}`);
  }
  if (!r.ok) {
    const e = new Error(`${method} ${p.split("?")[0]} returned HTTP ${r.status}: ${JSON.stringify(j).slice(0, 400)}`);
    e.status = r.status;
    throw e;
  }
  return j;
}
const needKey = "Pipedream only lets a personal API key do this. Copy it from pipedream.com/user (My Account, API Key) " +
  "into PIPEDREAM_API_KEY= in .env.local and run this again.";
const findUrl = o => /https:\/\/[a-z0-9-]+\.m\.pipedream\.net[^"\s]*/i.exec(JSON.stringify(o ?? {}))?.[0] ?? null;

// 1. workspace
const me = (await pd("GET", "/users/me", undefined, true).catch(e => {
  if (e.status === 401 && apiKey) fail("Pipedream rejected the API key. Copy it again from pipedream.com/user (My Account, API Key).");
  return { data: {} };
})).data ?? {};
const orgs = me.orgs ?? [];
const orgId = get("PIPEDREAM_ORG_ID") || get("PIPEDREAM_WORKSPACE_ID") || orgs[0]?.id;
if (!orgId) fail("could not find your Pipedream workspace. Add PIPEDREAM_WORKSPACE_ID=o_... to .env.local (Pipedream Settings, General).");
const org = orgs.find(o => o.id === orgId);
console.log(`Pipedream account: ${me.username ?? me.id ?? "(not shown for OAuth clients)"}. Workspace: ${org?.name ?? orgId}` +
  (orgs.length > 1 ? ` (1 of ${orgs.length}; set PIPEDREAM_WORKSPACE_ID in .env.local to use another)` : "") + ".");

// 2. the Google Business Profile logins connected in Pipedream (the query filter matches names, not apps)
const all = (await pd("GET", `/workspaces/${orgId}/accounts`)).data ?? [];
const accounts = all
  .filter(a => (a.app?.name_slug ?? a.app_slug) === "google_my_business" && a.dead !== true)
  .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
if (!accounts.length && !apiKey) {
  fail("the workspace OAuth client cannot see your Google Business Profile account, because Pipedream keeps connected " +
    "accounts private to the person who connected them. " + needKey);
}
if (!accounts.length) {
  fail("no Google Business Profile account is connected in Pipedream. Open https://pipedream.com/accounts, " +
    "click Connect an app, choose Google Business Profile and sign in with the Google account to use. Then run this again.");
}
console.log(`Google Business Profile logins in Pipedream: ${accounts.map(a => a.name ?? a.id).join(", ")}.`);

// 3. the token source: reused only if it was deployed for exactly these logins
const STATE = path.join(here, ".deployed.json");
let state = {};
try { state = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { /* first deploy from this folder */ }
const ids = accounts.map(a => a.id);
let url = null;
const sources = (await pd("GET", `/orgs/${orgId}/sources`).catch(e => { console.log(`Could not list sources: ${e.message}`); return { data: [] }; })).data ?? [];
const existing = sources.find(s => s.name === NAME || s.name_slug === NAME);
const sameLogins = existing && state.sourceId === existing.id && JSON.stringify(state.accounts ?? []) === JSON.stringify(ids);
if (existing && (replace || !sameLogins)) {
  await pd("DELETE", `/sources/${existing.id}`);
  console.log(`Removed the old token source ${existing.id}${replace ? "" : ", which was deployed for a different set of Google logins"}.`);
} else if (existing) {
  url = existing.configured_props?.http?.endpoint_url ?? findUrl(existing);
  console.log(`Reusing the token source already deployed for these logins (${existing.id}). Run with --replace to recreate it.`);
}

if (!url) {
  const code = componentCode(accounts);
  fs.writeFileSync(path.join(here, "google-token-source.mjs"), code);
  const created = await pd("POST", `/sources?org_id=${orgId}`, {
    component_code: code,
    name: NAME,
    configured_props: {
      ...Object.fromEntries(accounts.map((a, i) => [`gbp_${i + 1}`, { authProvisionId: a.id }])),
      secret,
    },
  });
  const id = created.data?.id;
  url = created.data?.configured_props?.http?.endpoint_url ?? findUrl(created);
  if (!url) {
    const again = (await pd("GET", `/orgs/${orgId}/sources`)).data ?? [];
    const s = again.find(x => x.id === id) ?? again.find(x => x.name === NAME);
    url = s?.configured_props?.http?.endpoint_url ?? findUrl(s);
  }
  if (!url) fail(`the source was created (${id}) but Pipedream did not return its URL. Copy it from the source's page in Pipedream into PIPEDREAM_TOKEN_URL in .env.local.`);
  fs.writeFileSync(STATE, JSON.stringify({ sourceId: id, accounts: ids, deployedAt: new Date().toISOString() }, null, 1));
  console.log(`Deployed the token source ${id} for ${accounts.length} Google login${accounts.length === 1 ? "" : "s"}.`);
}

// 4. save the URL for the app
env = fs.readFileSync(ENV, "utf8");
env = /^PIPEDREAM_TOKEN_URL=.*$/m.test(env)
  ? env.replace(/^PIPEDREAM_TOKEN_URL=.*$/m, `PIPEDREAM_TOKEN_URL=${url}`)
  : env.replace(/\s*$/, `\nPIPEDREAM_TOKEN_URL=${url}\n`);
fs.writeFileSync(ENV, env);
console.log(`Saved the source URL to .env.local: ${url}`);

// 5. check it end to end (this run costs one of the day's Pipedream credits)
const t = await fetchRetry(url, { method: "POST", headers: { "content-type": "application/json", "x-autopilot-secret": secret }, body: "{}" });
const tj = await t.json().catch(() => ({}));
const toks = Array.isArray(tj.tokens) ? tj.tokens : tj.access_token ? [{ id: "default", label: null, ...tj }] : [];
const good = toks.filter(x => x.access_token);
if (!t.ok || !good.length) {
  fail(`the source answered HTTP ${t.status} ${JSON.stringify(tj).slice(0, 200)}. ` +
    (t.status === 401 ? "The secret does not match: run again with --replace." : "Open the source in Pipedream to see its logs."));
}
for (const x of toks.filter(x => !x.access_token)) console.log(`  ${x.label ?? x.id}: no token (${x.error ?? "unknown"}).`);
console.log(`The source returns ${good.length} Google token${good.length === 1 ? "" : "s"}, valid for about ${Math.round(Math.min(...good.map(x => Number(x.expires_in) || 1800)) / 60)} minutes.`);

// Hand the tokens to the app (the settings rows src/lib/gauth.ts reads) so its first hour costs
// nothing more, and count the credit this test used.
try {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(here, "..", "data", "gbp.db"));
  const put = (k, v) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
  const day = new Date().toISOString().slice(0, 10);
  let n = 0;
  try { const c = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'pipedream_fetches'").get()?.value ?? "null"); if (c?.day === day) n = Number(c.n) || 0; } catch { /* first today */ }
  put("pipedream_fetches", JSON.stringify({ day, n: n + 1 }));
  const now = Date.now();
  put("pipedream_token", JSON.stringify(good.map(x => ({
    login: String(x.id), name: x.label ?? null, token: x.access_token,
    expiresAt: now + (Number(x.expires_in) || 1800) * 1000, email: x.email ?? null, scope: x.scope ?? null, fetchedAt: now,
  }))));
  db.close();
  console.log(`Handed the tokens to the app. Pipedream tokens used today: ${n + 1} of 3.`);
} catch (e) {
  console.log(`Could not hand the tokens to the app (${e.message}); it will fetch its own when needed.`);
}

// 6. each login: does Google accept it, and which Business Profile accounts does it manage?
let allOk = true;
for (const x of good) {
  const g = await fetchRetry("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", { headers: { Authorization: `Bearer ${x.access_token}` } });
  const gj = await g.json().catch(() => ({}));
  if (g.ok) {
    const names = (gj.accounts ?? []).map(a => a.accountName).filter(Boolean);
    console.log(`${x.label ?? x.id}: Google accepts it, ${names.length} Business Profile account${names.length === 1 ? "" : "s"}${names.length ? ` (${names.slice(0, 6).join(", ")})` : ""}.`);
  } else {
    allOk = false;
    console.log(`${x.label ?? x.id}: Google refused the call, HTTP ${g.status} ${gj.error?.status ?? ""} ${String(gj.error?.message ?? "").slice(0, 200)}`);
  }
}
if (allOk) console.log("\nDone. In the app, open Settings and press Test Google access, then Sync from Google on the dashboard.");

/** The Pipedream source code for these logins: one app prop per login, all tokens returned in one run. */
function componentCode(list) {
  const accs = list.map((a, i) => ({ prop: `gbp_${i + 1}`, id: a.id, label: a.name ?? null }));
  return [
    "// GBP Autopilot: Google token endpoint for Pipedream, one token per connected Google login.",
    "// GENERATED by pipedream/deploy.mjs for the Google Business Profile accounts connected in Pipedream;",
    "// change deploy.mjs, not this file. The app sends the shared secret in the x-autopilot-secret",
    "// header and gets a short-lived access token for every login in one run, so one credit covers all.",
    "// Nothing is emitted, so tokens never land in Pipedream's event history.",
    'import crypto from "crypto";',
    "",
    "const ACCOUNTS = " + JSON.stringify(accs, null, 2) + ";",
    "",
    "export default {",
    '  key: "gbp_autopilot-google-token",',
    '  name: "GBP Autopilot Google token",',
    '  description: "Hands GBP Autopilot short-lived Google Business Profile access tokens.",',
    '  version: "0.2.0",',
    '  type: "source",',
    "  props: {",
    ...accs.map(a => `    ${a.prop}: { type: "app", app: "google_my_business" },`),
    '    http: { type: "$.interface.http", customResponse: true },',
    '    secret: { type: "string", label: "Shared secret", secret: true },',
    "  },",
    "  async run(event) {",
    '    const json = { "content-type": "application/json", "cache-control": "no-store" };',
    '    const expected = String(this.secret || "");',
    '    const given = String(event.headers?.["x-autopilot-secret"] || "");',
    "    const ok = expected.length >= 32 && given.length === expected.length &&",
    "      crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));",
    "    if (!ok) {",
    '      this.http.respond({ status: 401, headers: json, body: { error: "unauthorised" } });',
    "      return;",
    "    }",
    "    const tokens = [];",
    "    for (const a of ACCOUNTS) {",
    "      const token = this[a.prop]?.$auth?.oauth_access_token;",
    '      if (!token) { tokens.push({ id: a.id, label: a.label, error: "not connected" }); continue; }',
    "      let info = {};",
    "      try {",
    '        const r = await fetch("https://oauth2.googleapis.com/tokeninfo?access_token=" + encodeURIComponent(token));',
    "        info = await r.json();",
    "      } catch (e) { /* the app assumes 30 minutes */ }",
    "      tokens.push({ id: a.id, label: a.label, access_token: token, expires_in: Number(info.expires_in) || 1800, scope: info.scope || null, email: info.email || null });",
    "    }",
    "    const good = tokens.filter(t => t.access_token);",
    "    if (!good.length) {",
    '      this.http.respond({ status: 500, headers: json, body: { error: "No Google Business Profile account is connected to this source", tokens } });',
    "      return;",
    "    }",
    "    this.http.respond({",
    "      status: 200,",
    "      headers: json,",
    "      body: { tokens, access_token: good[0].access_token, expires_in: Math.min(...good.map(t => t.expires_in)) },",
    "    });",
    "  },",
    "};",
    "",
  ].join("\n");
}
