import { accessToken, viaPipedream, dropBorrowedToken, googleLogins, pruneAccountLogins, rememberAccountLogin } from './gauth';
import { setSetting, run } from './db';
import { MOCK_ACCOUNTS, MOCK_CATEGORIES, MOCK_LOCATIONS, MOCK_REVIEWS } from './mock';

/**
 * Thin client over the Business Profile APIs.
 *
 * Three hosts are involved because Google split the old v4 API into per-feature services and
 * never finished: locations and categories live on Business Information v1, accounts on Account
 * Management v1, and reviews / posts / media are still only on the legacy v4 host.
 *
 * Mock mode (GBP_MOCK=1, or no Google connection) serves fixtures so every screen and job can be
 * exercised before Google approves API access. Writes in mock mode are logged and succeed.
 */
const BI = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const AM = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const V4 = 'https://mybusiness.googleapis.com/v4';

export const LOCATION_READ_MASK = [
  'name', 'title', 'storeCode', 'languageCode', 'phoneNumbers', 'websiteUri', 'storefrontAddress', 'latlng',
  'regularHours', 'categories', 'serviceItems', 'profile', 'labels', 'metadata', 'openInfo', 'serviceArea',
].join(',');

/** Manual businesses (account 'manual', id 'manual/...') have no Google side. Fail early and clearly. */
function assertLinked(nameOrAccount: string, what: string) {
  if (nameOrAccount.startsWith('manual')) {
    throw new Error(`This business was added by hand and is not linked to Google, so it cannot ${what}. Connect Google and sync the real profile.`);
  }
}

/**
 * Mock is opt-in only. It used to switch on whenever Google was unconnected, which meant a sync
 * silently re-created the sample businesses and there was no way to run the app "for real" before
 * Google approves API access.
 */
export function isMock(): boolean {
  return /^(1|true|on|yes)$/i.test(process.env.GBP_MOCK?.trim() ?? '');
}

export function explainGoogleError(status: number, json: any, fallback: string): string {
  const msg: string = json?.error?.message || fallback;
  const reason = json?.error?.errors?.[0]?.reason || json?.error?.status;
  if ((json?.error?.details ?? []).some((d: any) => d?.reason === 'PHONE_NUMBER_EDITS_NOT_ALLOWED')) {
    return PHONE_BLOCKED_MESSAGE;
  }
  if (viaPipedream()) {
    if (status === 401) return 'Google rejected the token from Pipedream. Open the workflow in Pipedream and reconnect the Google Business Profile account.';
    if (status === 403 && (/has not been used in project|is disabled/i.test(msg) || reason === 'accessNotConfigured')) {
      return 'This Google API is not switched on in Pipedream\'s Google project, so this feature cannot run through Pipedream. It will work once Google approves your own access request.';
    }
    if (status === 429) {
      return `Google returned 429 through Pipedream's connection, even after waiting about 90 seconds: ${msg} Pipedream shares its Google allowance with all its users, so try again in a few minutes. ` +
        'If only one feature keeps failing, Pipedream\'s Google project has no allowance for that API.';
    }
  }
  if (status === 403 && (/has not been used in project|is disabled/i.test(msg) || reason === 'accessNotConfigured')) {
    const project = /project (\d+)/.exec(msg)?.[1];
    return `A Business Profile API is not enabled on the OAuth client's Google Cloud project${project ? ` (${project})` : ''}. ` +
      'Enable all seven "My Business" APIs in APIs & Services > Library. If the library does not show them, ' +
      'Google has not approved the access request for that project yet.';
  }
  if (status === 403) {
    return `${msg} (403). Either Google has not approved API access for this project, or the connected account ` +
      'is not a Manager on this profile.';
  }
  if (status === 429) {
    // An unapproved project is given a quota of ZERO queries per minute, so the very first call of
    // the day comes back 429. It reads like rate limiting and is actually "access not granted yet".
    return 'Google returned 429 (quota exceeded). On a project that has not had the Business Profile API ' +
      'access request approved the quota is literally 0 queries per minute, so the first call fails this way. ' +
      'Check APIs & Services > Quotas: 0 QPM means not approved yet, 300 QPM means live. If it shows 300, ' +
      'this really is rate limiting and retrying in a minute will work.';
  }
  if (status === 401) return 'Google rejected the token. Reconnect on the Settings page.';
  return msg;
}

const PIPEDREAM_429_WAITS = [15_000, 30_000, 45_000];

/** Google refuses phone number edits through the API for some profiles, in every format. */
export const PHONE_BLOCKED_MESSAGE = 'Google does not allow this profile\u2019s phone number to be changed from outside Google. ' +
  'Add or change it in Google Business Profile: open business.google.com, choose Edit profile, then Contact.';

async function call<T = any>(url: string, init: RequestInit = {}, opts: { login?: string; retried?: boolean; waited?: number } = {}): Promise<T> {
  const token = await accessToken({ login: opts.login, resource: url });
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    cache: 'no-store',
  });
  const text = await res.text();
  const json = text ? (() => { try { return JSON.parse(text); } catch { return { raw: text }; } })() : {};
  // A borrowed token can be revoked or refreshed on Pipedream's side before our cached copy expires.
  if (res.status === 401 && viaPipedream() && !opts.retried) { dropBorrowedToken(); return call<T>(url, init, { ...opts, retried: true }); }
  // Pipedream's Google quota is per minute and shared by all its users, so a busy minute returns
  // 429 even for our first call. Wait for the next minute and retry (about 90 seconds at most).
  const waited = opts.waited ?? 0;
  if (res.status === 429 && viaPipedream() && waited < PIPEDREAM_429_WAITS.length) {
    await new Promise(r => setTimeout(r, PIPEDREAM_429_WAITS[waited]));
    return call<T>(url, init, { ...opts, waited: waited + 1 });
  }
  if (!res.ok) throw new Error(explainGoogleError(res.status, json, res.statusText));
  return json as T;
}

/** Settings > Test Google access: list accounts and their locations, and keep the outcome for the page. */
export async function testAccess(): Promise<{ ok: boolean; detail: string }> {
  const via = isMock() ? 'mock mode' : viaPipedream() ? 'Pipedream' : 'your own Google connection';
  let out: { ok: boolean; detail: string };
  try {
    const logins = isMock() ? [] : await googleLogins();
    const accounts = await listAccounts();
    const titles: string[] = [];
    for (const a of accounts) titles.push(...(await listLocations(a.name)).map(l => l.title));
    const s = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
    out = {
      ok: true,
      detail: `Working through ${via}: ${logins.length > 1 ? `${s(logins.length, 'Google login')} (${logins.map(l => l.name ?? l.login).join(', ')}), ` : ''}${s(accounts.length, 'account')}, ${s(titles.length, 'location')}` +
        (titles.length ? ` (${titles.slice(0, 8).join(', ')}${titles.length > 8 ? ', and more' : ''}).` : '.'),
    };
  } catch (e: any) {
    out = { ok: false, detail: `Failed through ${via}: ${e?.message ?? e}` };
  }
  setSetting('google_test', JSON.stringify({ ...out, at: new Date().toISOString() }));
  return out;
}

// ---------- accounts & locations ----------

export type GAccount = { name: string; accountName: string; type: string };
export type GLocation = Record<string, any> & { name: string; title: string };

export async function listAccounts(): Promise<GAccount[]> {
  if (isMock()) return MOCK_ACCOUNTS;
  // Each Google login sees its own Business Profile accounts; remember which login manages which,
  // so later calls for that account or its locations use the right token. Anything the map still
  // claims for a login we no longer hold is dropped first, so a sync repairs it (see gauth.ts).
  pruneAccountLogins();
  const out: GAccount[] = [];
  for (const { login } of await googleLogins()) {
    let pageToken = '';
    do {
      const j = await call<{ accounts?: GAccount[]; nextPageToken?: string }>(`${AM}/accounts?pageSize=20${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, {}, { login });
      for (const a of j.accounts ?? []) {
        if (out.some(x => x.name === a.name)) continue;
        out.push(a);
        rememberAccountLogin(a.name, login);
      }
      pageToken = j.nextPageToken ?? '';
    } while (pageToken);
  }
  return out;
}

export async function listLocations(account: string): Promise<GLocation[]> {
  if (isMock()) return MOCK_LOCATIONS.filter(l => l._account === account);
  const out: GLocation[] = [];
  let pageToken = '';
  do {
    const qs = new URLSearchParams({ readMask: LOCATION_READ_MASK, pageSize: '100' });
    if (pageToken) qs.set('pageToken', pageToken);
    const j = await call<{ locations?: GLocation[]; nextPageToken?: string }>(`${BI}/${account}/locations?${qs}`);
    out.push(...(j.locations ?? []));
    pageToken = j.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

export async function getLocation(name: string): Promise<GLocation> {
  assertLinked(name, 're-read the profile');
  if (isMock()) {
    const l = MOCK_LOCATIONS.find(x => x.name === name);
    if (!l) throw new Error(`Mock location ${name} not found`);
    return l;
  }
  return call<GLocation>(`${BI}/${name}?readMask=${encodeURIComponent(LOCATION_READ_MASK)}`);
}

/** updateMask is a comma-separated list of top-level (or dotted) field names being changed. */
export async function patchLocation(name: string, body: Record<string, any>, updateMask: string[], validateOnly = false): Promise<GLocation> {
  assertLinked(name, 'write to the profile');
  if (isMock()) {
    const l = MOCK_LOCATIONS.find(x => x.name === name);
    // The real API echoes categories back with displayName filled in; do the same here.
    if (body.categories) {
      const fill = (c: any) => ({ ...c, displayName: c.displayName ?? MOCK_CATEGORIES.find(m => m.name === c.name)?.displayName ?? c.name });
      body = { ...body, categories: {
        primaryCategory: body.categories.primaryCategory && fill(body.categories.primaryCategory),
        additionalCategories: (body.categories.additionalCategories ?? []).map(fill),
      } };
    }
    if (l && !validateOnly) Object.assign(l, body);
    return { ...(l ?? { name, title: '' }), ...body };
  }
  const qs = new URLSearchParams({ updateMask: updateMask.join(',') });
  if (validateOnly) qs.set('validateOnly', 'true');
  return call<GLocation>(`${BI}/${name}?${qs}`, { method: 'PATCH', body: JSON.stringify(body) });
}

// ---------- categories ----------

export type GCategory = { name: string; displayName: string };

export async function searchCategories(region: string, language: string, filter?: string): Promise<GCategory[]> {
  if (isMock()) {
    const f = filter?.toLowerCase();
    return MOCK_CATEGORIES.filter(c => !f || c.displayName.toLowerCase().includes(f));
  }
  const out: GCategory[] = [];
  let pageToken = '';
  do {
    const qs = new URLSearchParams({ regionCode: region, languageCode: language, view: 'BASIC', pageSize: '100' });
    if (filter) qs.set('filter', `displayName=${filter}`);
    if (pageToken) qs.set('pageToken', pageToken);
    const j = await call<{ categories?: GCategory[]; nextPageToken?: string }>(`${BI}/categories?${qs}`);
    out.push(...(j.categories ?? []));
    pageToken = j.nextPageToken ?? '';
    // A filtered search rarely needs more than a page; an unfiltered one is thousands.
    if (filter && out.length >= 100) break;
  } while (pageToken);
  // Keep a local copy, so a category name (from a competitor, say) can be matched to Google's id later
  // without another Google call.
  for (const c of out) {
    run(`INSERT INTO categories (name, display_name, region) VALUES (?,?,?)
         ON CONFLICT(name, region) DO UPDATE SET display_name = excluded.display_name, fetched_at = datetime('now')`, c.name, c.displayName, region);
  }
  return out;
}

// ---------- reviews (v4) ----------

export type GReview = {
  reviewId: string;
  reviewer?: { displayName?: string; profilePhotoUrl?: string; isAnonymous?: boolean };
  starRating?: 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE' | string;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment?: string; updateTime?: string };
};

export const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

/** v4 paths are accounts/{a}/locations/{l}; the v1 location name is only 'locations/{l}'. */
export function v4Name(account: string, location: string): string {
  return `${account}/${location}`;
}

export async function listReviews(account: string, location: string, max = 200): Promise<GReview[]> {
  assertLinked(account, 'fetch reviews');
  if (isMock()) return MOCK_REVIEWS.filter(r => r._location === location);
  const out: GReview[] = [];
  let pageToken = '';
  do {
    const qs = new URLSearchParams({ pageSize: '50', orderBy: 'updateTime desc' });
    if (pageToken) qs.set('pageToken', pageToken);
    const j = await call<{ reviews?: GReview[]; nextPageToken?: string }>(`${V4}/${v4Name(account, location)}/reviews?${qs}`);
    out.push(...(j.reviews ?? []));
    pageToken = j.nextPageToken ?? '';
  } while (pageToken && out.length < max);
  return out;
}

/** One review as Google holds it now, or null when Google no longer has it. */
export async function getReview(account: string, location: string, reviewId: string): Promise<GReview | null> {
  assertLinked(account, 'fetch reviews');
  if (isMock()) return MOCK_REVIEWS.find(r => r.reviewId === reviewId) ?? null;
  return call<GReview>(`${V4}/${v4Name(account, location)}/reviews/${reviewId}`);
}

export async function replyToReview(account: string, location: string, reviewId: string, comment: string): Promise<void> {
  assertLinked(account, 'reply to reviews');
  if (isMock()) {
    const r = MOCK_REVIEWS.find(x => x.reviewId === reviewId);
    if (r) r.reviewReply = { comment, updateTime: new Date().toISOString() };
    return;
  }
  await call(`${V4}/${v4Name(account, location)}/reviews/${reviewId}/reply`, { method: 'PUT', body: JSON.stringify({ comment }) });
}

// ---------- local posts (v4) ----------

export type GLocalPost = {
  name?: string;
  languageCode?: string;
  summary: string;
  topicType: 'STANDARD' | 'EVENT' | 'OFFER' | 'ALERT';
  callToAction?: { actionType: 'BOOK' | 'ORDER' | 'SHOP' | 'LEARN_MORE' | 'SIGN_UP' | 'CALL'; url?: string };
  media?: { mediaFormat: 'PHOTO' | 'VIDEO'; sourceUrl: string }[];
  event?: { title: string; schedule: { startDate: any; endDate: any; startTime?: any; endTime?: any } };
  offer?: { couponCode?: string; redeemOnlineUrl?: string; termsConditions?: string };
  state?: string;
  createTime?: string;
  searchUrl?: string;
};

export async function createLocalPost(account: string, location: string, post: GLocalPost): Promise<GLocalPost> {
  assertLinked(account, 'publish posts');
  if (isMock()) return { ...post, name: `${v4Name(account, location)}/localPosts/mock-${Date.now()}`, state: 'LIVE', createTime: new Date().toISOString() };
  return call<GLocalPost>(`${V4}/${v4Name(account, location)}/localPosts`, { method: 'POST', body: JSON.stringify(post) });
}

export async function listLocalPosts(account: string, location: string): Promise<GLocalPost[]> {
  if (isMock()) return [];
  const j = await call<{ localPosts?: GLocalPost[] }>(`${V4}/${v4Name(account, location)}/localPosts?pageSize=20`);
  return j.localPosts ?? [];
}

// ---------- media (v4) ----------

export async function createPhoto(account: string, location: string, sourceUrl: string, category = 'ADDITIONAL', description?: string) {
  assertLinked(account, 'upload photos');
  if (isMock()) return { name: 'mock-media', sourceUrl };
  return call(`${V4}/${v4Name(account, location)}/media`, {
    method: 'POST',
    body: JSON.stringify({ mediaFormat: 'PHOTO', sourceUrl, locationAssociation: { category }, description }),
  });
}

// ---------- photos (v4 media) ----------

export type GMedia = { name: string; mediaFormat?: string; createTime?: string; locationAssociation?: { category?: string } };

/** Photos and videos the business itself has added, and the total Google reports. */
export async function listMedia(account: string, location: string): Promise<{ items: GMedia[]; total: number }> {
  assertLinked(account, 'read photos');
  if (isMock()) {
    const items = Array.from({ length: 7 }, (_, i) => ({ name: `media/mock-${i}`, mediaFormat: 'PHOTO', createTime: new Date(Date.now() - (i * 20 + 12) * 86_400_000).toISOString() }));
    return { items, total: items.length };
  }
  const out: GMedia[] = [];
  let total = 0, pageToken = '';
  do {
    const j = await call<{ mediaItems?: GMedia[]; totalMediaItemCount?: number; nextPageToken?: string }>(
      `${V4}/${v4Name(account, location)}/media?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
    out.push(...(j.mediaItems ?? []));
    total = j.totalMediaItemCount ?? out.length;
    pageToken = j.nextPageToken ?? '';
  } while (pageToken && out.length < 500);
  return { items: out, total };
}

/** How many photos customers have added (Google counts them separately). */
export async function customerMediaCount(account: string, location: string): Promise<number> {
  if (isMock()) return 3;
  const j = await call<{ totalMediaItemCount?: number; mediaItems?: unknown[] }>(`${V4}/${v4Name(account, location)}/media/customers?pageSize=1`);
  return j.totalMediaItemCount ?? j.mediaItems?.length ?? 0;
}

// Q&A: Google retired the Q&A API on 3 November 2025 and removed public Q&A from profiles, so the
// app no longer seeds or posts questions (the old `qna` table is kept, unused).

// ---------- Performance (businessprofileperformance v1) ----------

const PERF = 'https://businessprofileperformance.googleapis.com/v1';

export const DAILY_METRICS = [
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
  'CALL_CLICKS', 'WEBSITE_CLICKS', 'BUSINESS_DIRECTION_REQUESTS', 'BUSINESS_CONVERSATIONS', 'BUSINESS_BOOKINGS',
] as const;
export type DailyMetric = typeof DAILY_METRICS[number];
export type MetricPoint = { day: string; metric: DailyMetric; value: number };

const ymd = (d: Date) => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });

/** Daily values for every metric over [start, end]. Google needs a day or two to finalise the latest days. */
export async function fetchDailyMetrics(location: string, start: Date, end: Date): Promise<MetricPoint[]> {
  assertLinked(location, 'read performance stats');
  if (isMock()) {
    const out: MetricPoint[] = [];
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const day = d.toISOString().slice(0, 10);
      const seed = Number(location.replace(/\D/g, '').slice(-3)) + d.getUTCDate();
      for (const m of DAILY_METRICS) {
        const base = m.startsWith('BUSINESS_IMPRESSIONS') ? 40 : m === 'CALL_CLICKS' ? 3 : m === 'WEBSITE_CLICKS' ? 4 : m === 'BUSINESS_DIRECTION_REQUESTS' ? 2 : 0;
        out.push({ day, metric: m, value: base ? Math.max(0, Math.round(base + ((seed * 7 + m.length) % 11) - 5 + (d.getUTCDay() === 0 ? -base / 2 : 0))) : 0 });
      }
    }
    return out;
  }
  const qs = new URLSearchParams();
  for (const m of DAILY_METRICS) qs.append('dailyMetrics', m);
  const s = ymd(start), e = ymd(end);
  qs.set('dailyRange.startDate.year', String(s.year)); qs.set('dailyRange.startDate.month', String(s.month)); qs.set('dailyRange.startDate.day', String(s.day));
  qs.set('dailyRange.endDate.year', String(e.year)); qs.set('dailyRange.endDate.month', String(e.month)); qs.set('dailyRange.endDate.day', String(e.day));
  const j = await call<any>(`${PERF}/${location}:fetchMultiDailyMetricsTimeSeries?${qs}`);
  const out: MetricPoint[] = [];
  for (const series of j.multiDailyMetricTimeSeries ?? []) {
    for (const dm of series.dailyMetricTimeSeries ?? []) {
      const metric = dm.dailyMetric as DailyMetric;
      for (const p of dm.timeSeries?.datedValues ?? []) {
        const d = p.date; if (!d?.year) continue;
        out.push({ day: `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`, metric, value: Number(p.value ?? 0) });
      }
    }
  }
  return out;
}
