import { all, one, run, parse, log, rekeyLocation, getSetting, setSetting } from './db';
import { listAccounts, listLocations, getLocation as fetchLocation, patchLocation, searchCategories, PHONE_BLOCKED_MESSAGE, type GLocation } from './gbp';
import { checkPhone, normaliseWebsite } from './basics-check';

export type LocationRow = {
  id: string; account: string; title: string; store_code: string | null; language_code: string | null;
  phone: string | null; website: string | null; description: string | null;
  address_json: string | null; latlng_json: string | null; hours_json: string | null; categories_json: string | null;
  services_json: string | null; attributes_json: string | null; labels_json: string | null; service_area_json: string | null;
  maps_uri: string | null; place_id: string | null; new_review_uri: string | null; raw_json: string | null; synced_at: string | null;
  brand_voice: string | null; offered_services: string | null; service_areas: string | null; site_slug: string | null; site_colour: string | null;
  auto_reply: number; auto_post: number; post_weekday: number; post_hour: number; next_post_at: string | null; last_review_poll: string | null;
  ghl_contact_id: string | null; ghl_pushed_at: string | null; report_url: string | null;
  photo_every_days: number; next_photo_at: string | null; metrics_synced_at: string | null;
  public_cid: string | null; public_json: string | null; public_synced_at: string | null;
  benchmark_json: string | null; benchmark_at: string | null; benchmark_query: string | null;
  keywords_weekly: number; next_keywords_at: string | null;
  grid_monthly: number; next_grid_at: string | null;
  photos_count: number | null; photos_customer_count: number | null; photos_latest_at: string | null; photos_synced_at: string | null;
  geo_json: string | null; geo_at: string | null;
  hold_low_stars: number;
  created_at: string;
};

export type Address = { regionCode?: string; postalCode?: string; locality?: string; administrativeArea?: string; addressLines?: string[] };
export type Categories = { primaryCategory?: { name: string; displayName?: string }; additionalCategories?: { name: string; displayName?: string }[] };

export function locations(): LocationRow[] {
  return all<LocationRow>('SELECT * FROM locations ORDER BY title');
}
export function location(id: string): LocationRow | undefined {
  return one<LocationRow>('SELECT * FROM locations WHERE id = ?', id);
}

/** Derived, parsed view used by audit, prompts and the site generator. */
export function view(l: LocationRow) {
  const address = parse<Address>(l.address_json, {});
  const cats = parse<Categories>(l.categories_json, {});
  const services = parse<any[]>(l.services_json, []);
  const hours = parse<any>(l.hours_json, {});
  const latlng = parse<{ latitude?: number; longitude?: number }>(l.latlng_json, {});
  return {
    ...l,
    address,
    addressLine: [...(address.addressLines ?? []), address.locality, address.administrativeArea, address.postalCode].filter(Boolean).join(', '),
    town: address.locality ?? '',
    region: address.regionCode ?? 'GB',
    lang: (l.language_code ?? 'en-GB').split('-')[0],
    primaryCategory: cats.primaryCategory && withLabel(cats.primaryCategory),
    additionalCategories: (cats.additionalCategories ?? []).map(withLabel),
    serviceNames: services.map(serviceName).filter(Boolean) as string[],
    hoursPeriods: (hours?.periods ?? []) as any[],
    latlng,
    offeredServices: parse<string[]>(l.offered_services, []),
    serviceAreas: parse<string[]>(l.service_areas, []),
  };
}
export type LocationView = ReturnType<typeof view>;

/** Google may omit displayName on a category it just accepted; derive one from the gcid rather than show nothing. */
function withLabel(c: { name: string; displayName?: string }) {
  return { ...c, displayName: c.displayName || c.name.replace(/^categories\/gcid:/, '').replace(/_/g, ' ').replace(/^\w/, ch => ch.toUpperCase()) };
}

export function serviceName(item: any): string {
  return item?.freeFormServiceItem?.label?.displayName ?? item?.structuredServiceItem?.description ?? item?.structuredServiceItem?.serviceTypeId?.replace(/^job_type_id:/, '').replace(/_/g, ' ') ?? '';
}

export function upsertFromGoogle(account: string, g: GLocation) {
  const existing = location(g.name);
  const cols = {
    title: g.title ?? existing?.title ?? '',
    store_code: g.storeCode ?? null,
    language_code: g.languageCode ?? null,
    phone: g.phoneNumbers?.primaryPhone ?? null,
    website: g.websiteUri ?? null,
    description: g.profile?.description ?? null,
    address_json: JSON.stringify(g.storefrontAddress ?? null),
    latlng_json: JSON.stringify(g.latlng ?? null),
    hours_json: JSON.stringify(g.regularHours ?? null),
    categories_json: JSON.stringify(g.categories ?? null),
    services_json: JSON.stringify(g.serviceItems ?? []),
    labels_json: JSON.stringify(g.labels ?? []),
    service_area_json: JSON.stringify(g.serviceArea ?? null),
    maps_uri: g.metadata?.mapsUri ?? null,
    place_id: g.metadata?.placeId ?? null,
    new_review_uri: g.metadata?.newReviewUri ?? null,
    raw_json: JSON.stringify(g),
  };
  if (existing) {
    const sets = Object.keys(cols).map(k => `${k} = ?`).join(', ');
    run(`UPDATE locations SET ${sets}, account = ?, synced_at = datetime('now') WHERE id = ?`, ...Object.values(cols), account, g.name);
    // A new address means the position worked out from the old one is wrong; the next map view redoes it.
    if (existing.address_json !== cols.address_json) run(`UPDATE locations SET geo_json = NULL, geo_at = NULL WHERE id = ?`, g.name);
  } else {
    const keys = Object.keys(cols);
    run(
      `INSERT INTO locations (id, account, ${keys.join(', ')}, site_slug, synced_at) VALUES (?, ?, ${keys.map(() => '?').join(', ')}, ?, datetime('now'))`,
      g.name, account, ...Object.values(cols), slugify(cols.title)
    );
  }
}

/**
 * A business first added by hand (id manual/...) that a Google sync now returns is the same
 * business. Match on place id, else on the Maps cid, and move the hand-added row and all its history
 * to the Google id, so the sync links it instead of creating a second copy.
 */
function adoptManual(account: string, g: GLocation): boolean {
  if (location(g.name)) return false;
  const placeId: string = g.metadata?.placeId ?? '';
  const cid = /[?&]cid=(\d+)/.exec(String(g.metadata?.mapsUri ?? ''))?.[1] ?? '';
  if (!placeId && !cid) return false;
  const m = one<{ id: string }>(
    `SELECT id FROM locations WHERE account = ?
       AND ((? <> '' AND place_id = ?) OR (? <> '' AND public_cid = ?)) LIMIT 1`,
    MANUAL_ACCOUNT, placeId, placeId, cid, cid
  );
  if (!m) return false;
  rekeyLocation(m.id, g.name, account);
  // Reviews read from the public listing carry Maps ids, not the API's, so the first review poll
  // would list every review twice. Drop them; the next scheduler tick polls the full list from
  // Google with ids that replies can be posted to.
  run('DELETE FROM reviews WHERE location_id = ?', g.name);
  run('UPDATE locations SET last_review_poll = NULL WHERE id = ?', g.name);
  log('sync', 'ok', `Hand-added business linked to its Google profile (was ${m.id})`, g.name);
  return true;
}

export async function syncAll(): Promise<{ accounts: number; locations: number; linked: number }> {
  const accounts = await listAccounts();
  let n = 0, linked = 0;
  for (const a of accounts) {
    const locs = await listLocations(a.name);
    for (const l of locs) {
      if (adoptManual(a.name, l)) linked++;
      upsertFromGoogle(a.name, l);
      n++;
    }
  }
  log('sync', 'ok', `${accounts.length} accounts, ${n} locations` + (linked ? `, ${linked} hand-added linked to Google` : ''));
  return { accounts: accounts.length, locations: n, linked };
}

export async function resync(id: string) {
  const l = location(id);
  if (!l) throw new Error('Unknown location');
  const g = await fetchLocation(id);
  upsertFromGoogle(l.account, g);
  return location(id)!;
}

export type Config = Partial<Pick<LocationRow, 'brand_voice' | 'offered_services' | 'service_areas' | 'site_slug' | 'site_colour' | 'auto_reply' | 'auto_post' | 'post_weekday' | 'post_hour' | 'next_post_at' | 'ghl_contact_id' | 'ghl_pushed_at' | 'report_url' | 'photo_every_days' | 'next_photo_at' | 'metrics_synced_at' | 'keywords_weekly' | 'next_keywords_at' | 'grid_monthly' | 'next_grid_at' | 'hold_low_stars'>>;

/** Columns a config update may touch. Keys come from the browser, so anything else is ignored. */
const CONFIG_KEYS = new Set(['brand_voice', 'offered_services', 'service_areas', 'site_slug', 'site_colour', 'auto_reply', 'auto_post', 'post_weekday', 'post_hour', 'next_post_at',
  'ghl_contact_id', 'ghl_pushed_at', 'report_url', 'photo_every_days', 'next_photo_at', 'metrics_synced_at', 'keywords_weekly', 'next_keywords_at', 'grid_monthly', 'next_grid_at', 'hold_low_stars']);

export function updateConfig(id: string, cfg: Config) {
  const keys = (Object.keys(cfg) as (keyof Config)[]).filter(k => CONFIG_KEYS.has(k));
  if (!keys.length) return;
  // The folder name becomes a folder on disk that is emptied before every build, so it is stored
  // as a plain slug: no slashes, no dots, nothing that could point anywhere else.
  if (keys.includes('site_slug')) cfg = { ...cfg, site_slug: String(cfg.site_slug ?? '').trim() ? slugify(String(cfg.site_slug)) : null };
  run(`UPDATE locations SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map(k => cfg[k] ?? null), id);
}

export const MANUAL_ACCOUNT = 'manual';
export const isLinked = (l: Pick<LocationRow, 'account'>) => l.account !== MANUAL_ACCOUNT;

export type ManualInput = {
  title: string; street: string; town: string; county?: string; postcode: string; phone?: string; website?: string; category?: string; region?: string;
};

/**
 * A business typed in by hand, so the citation audit and site generator can run before (or without)
 * a Google connection. Stored in the same table with account = 'manual'; every Google write path
 * refuses these ids.
 */
export function saveManual(input: ManualInput, id?: string): LocationRow {
  const title = input.title.trim();
  if (!title) throw new Error('Business name is required');
  if (!input.postcode?.trim() && !input.phone?.trim()) throw new Error('Give at least a postcode or a phone number, or there is nothing to audit against');
  const address = {
    regionCode: (input.region || 'GB').toUpperCase(),
    postalCode: input.postcode?.trim().toUpperCase() || undefined,
    locality: input.town?.trim() || undefined,
    administrativeArea: input.county?.trim() || undefined,
    addressLines: input.street?.trim() ? [input.street.trim()] : [],
  };
  const categories = input.category?.trim()
    ? { primaryCategory: { name: `categories/gcid:${slugify(input.category).replace(/-/g, '_')}`, displayName: input.category.trim() } }
    : null;
  const cols = {
    title, phone: input.phone?.trim() || null, website: input.website?.trim() || null,
    address_json: JSON.stringify(address), categories_json: JSON.stringify(categories), language_code: 'en-GB',
  };
  if (id) {
    const existing = location(id);
    if (!existing || isLinked(existing)) throw new Error('Only manual businesses can be edited here');
    run(`UPDATE locations SET ${Object.keys(cols).map(k => `${k} = ?`).join(', ')} WHERE id = ?`, ...Object.values(cols), id);
    if (existing.address_json !== cols.address_json) run(`UPDATE locations SET geo_json = NULL, geo_at = NULL WHERE id = ?`, id);
    return location(id)!;
  }
  const newId = `${MANUAL_ACCOUNT}/${slugify(title)}-${Math.random().toString(36).slice(2, 6)}`;
  const keys = Object.keys(cols);
  run(`INSERT INTO locations (id, account, ${keys.join(', ')}, site_slug) VALUES (?, ?, ${keys.map(() => '?').join(', ')}, ?)`,
    newId, MANUAL_ACCOUNT, ...Object.values(cols), slugify(title));
  return location(newId)!;
}

/**
 * Remove a location from this app only. Nothing is deleted at Google; a later sync re-adds a
 * profile the connected account still manages. Local audits, drafts and pages go with it.
 */
export function deleteLocation(id: string) {
  if (!location(id)) return;
  run('DELETE FROM locations WHERE id = ?', id);
}

export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'site';
}

// ---------- business details edited in the app ----------

export const WEEK = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;
export type Day = typeof WEEK[number];
export type BasicsInput = {
  phone?: string;
  website?: string;
  /** One opening period per open day, times as HH:MM. Days left out are closed. */
  hours?: { day: Day; open: string; close: string }[];
  /** Category resource names from Google's own list (categories/gcid:...), primary first. */
  categories?: { primary: string; additional: string[] };
};

const categoryCache = globalThis as unknown as { __gbpCatSearch?: Map<string, { at: number; list: { name: string; displayName: string }[] }> };

/**
 * Match a category name as listings show it ("Solar energy company") to Google's own category, so it
 * can be added. The local copy of Google's list is checked first; otherwise Google is searched.
 */
export async function resolveCategory(id: string, displayName: string): Promise<{ name: string; displayName: string }> {
  const l = location(id);
  if (!l) throw new Error('Unknown business.');
  const want = displayName.trim();
  const v = view(l);
  const local = one<{ name: string; display_name: string }>(
    'SELECT name, display_name FROM categories WHERE region = ? AND lower(display_name) = lower(?)', v.region, want);
  if (local) return { name: local.name, displayName: local.display_name };
  const hit = (await findCategories(id, want)).find(c => c.displayName.toLowerCase() === want.toLowerCase());
  if (!hit) throw new Error(`Google’s category list has no category called “${want}” for this country, so it cannot be added. Search for a similar one below.`);
  return hit;
}

/**
 * Search Google's category list for the category picker. Results are cached for a day per word,
 * because every search is a Google call and people type the same words again.
 */
export async function findCategories(id: string, term: string): Promise<{ name: string; displayName: string }[]> {
  const l = location(id);
  if (!l) throw new Error('Unknown business.');
  const q = term.trim();
  if (q.length < 2) return [];
  const v = view(l);
  const key = `${v.region}|${v.lang}|${q.toLowerCase()}`;
  const cache = (categoryCache.__gbpCatSearch ??= new Map());
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 24 * 3_600_000) return hit.list;
  const list = (await searchCategories(v.region, v.lang, q))
    .map(c => ({ name: c.name, displayName: c.displayName }))
    .sort((a, b) => {
      // Names that start with the word first ("Marketing agency" before "Internet marketing service").
      const sa = a.displayName.toLowerCase().startsWith(q.toLowerCase()) ? 0 : 1;
      const sb = b.displayName.toLowerCase().startsWith(q.toLowerCase()) ? 0 : 1;
      return sa - sb || a.displayName.localeCompare(b.displayName);
    })
    .slice(0, 25);
  cache.set(key, { at: Date.now(), list });
  return list;
}

function hhmm(t: string, what: string): { hours: number; minutes: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  const h = m ? Number(m[1]) : NaN, min = m ? Number(m[2]) : NaN;
  if (!m || h > 23 || min > 59) throw new Error(`${what} "${t}" is not a time. Use the 24-hour clock, for example 09:00 or 17:30.`);
  return { hours: h, minutes: min };
}

/**
 * Save phone, website and opening hours to Google, then re-read the profile so the audit and the
 * header show the new values. Only the fields passed are sent; the rest of the profile is untouched.
 * Name and address are deliberately not editable here: Google re-verifies a business after either.
 */
/** Profiles whose phone number Google refused to change through the API (learnt on the first refusal). */
export function phoneEditBlocked(id: string): boolean {
  return parse<string[]>(getSetting('phone_edit_blocked'), []).includes(id);
}
function markPhoneEditBlocked(id: string) {
  const ids = parse<string[]>(getSetting('phone_edit_blocked'), []);
  if (!ids.includes(id)) setSetting('phone_edit_blocked', JSON.stringify([...ids, id]));
}

export async function saveBasics(id: string, input: BasicsInput): Promise<{ saved: string[]; notSaved: { field: string; reason: string }[] }> {
  const l = location(id);
  if (!l) throw new Error('Unknown business.');
  if (!isLinked(l)) throw new Error('This business was added by hand, so there is no Google profile to save to. Link it to Google first.');

  // Website and hours go in one request; the phone number goes on its own, because Google refuses
  // phone edits for some profiles and that refusal must not stop the rest from saving.
  const body: Record<string, any> = {};
  const mask: string[] = [];
  const fields: string[] = [];
  if (input.website !== undefined) {
    const w = normaliseWebsite(input.website);
    if (w.error) throw new Error(w.error);
    body.websiteUri = w.value;
    mask.push('websiteUri');
    fields.push('website');
  }
  if (input.hours !== undefined) {
    const periods = input.hours.filter(h => (WEEK as readonly string[]).includes(h.day)).map(h => {
      const open = hhmm(h.open, 'Opening time');
      const close = hhmm(h.close, 'Closing time');
      const o = open.hours * 60 + open.minutes, c = close.hours * 60 + close.minutes;
      // Closing at 00:00 means midnight the same day (Google writes it as 24:00); an earlier closing
      // time than opening means the business closes after midnight, on the next day.
      if (c === 0) return { openDay: h.day, openTime: open, closeDay: h.day, closeTime: { hours: 24, minutes: 0 } };
      const next = WEEK[(WEEK.indexOf(h.day) + 1) % 7];
      return { openDay: h.day, openTime: open, closeDay: c <= o ? next : h.day, closeTime: close };
    });
    body.regularHours = { periods };
    mask.push('regularHours');
    fields.push('opening hours');
  }
  let categories: { primaryCategory: { name: string }; additionalCategories: { name: string }[] } | undefined;
  if (input.categories !== undefined) {
    const isCat = (n: string) => /^categories\/gcid:[a-z0-9_]+$/.test(n);
    const primary = input.categories.primary;
    const additional = [...new Set(input.categories.additional)].filter(n => n !== primary);
    if (!isCat(primary)) throw new Error('Choose a primary category from Google\u2019s list.');
    if (additional.some(n => !isCat(n))) throw new Error('Every category must come from Google\u2019s list. Search for it in the picker.');
    if (additional.length > 9) throw new Error('Google allows up to 9 additional categories. Remove some first.');
    categories = { primaryCategory: { name: primary }, additionalCategories: additional.map(name => ({ name })) };
  }
  let phone: string | undefined;
  if (input.phone !== undefined) {
    if (phoneEditBlocked(l.id)) throw new Error(PHONE_BLOCKED_MESSAGE);
    const err = checkPhone(input.phone);
    if (err) throw new Error(err);
    phone = input.phone.trim();
  }

  const saved: string[] = [];
  const notSaved: { field: string; reason: string }[] = [];
  if (mask.length) {
    try {
      await patchLocation(l.id, body, mask);
      saved.push(...fields);
      log('basics', 'ok', `Saved ${fields.join(', ')}`, l.id);
    } catch (e: any) {
      log('basics', 'error', `${fields.join(', ')}: ${e.message}`, l.id);
      if (phone === undefined && !categories) throw e;
      notSaved.push({ field: fields.join(' and '), reason: e.message });
    }
  }
  if (categories) {
    try {
      await patchLocation(l.id, { categories }, ['categories']);
      saved.push('categories');
      log('basics', 'ok', `Saved categories: ${[categories.primaryCategory, ...categories.additionalCategories].map(c => c.name.replace('categories/gcid:', '').replace(/_/g, ' ')).join(', ')}`, l.id);
    } catch (e: any) {
      log('basics', 'error', `categories: ${e.message}`, l.id);
      if (!mask.length && phone === undefined) throw e;
      notSaved.push({ field: 'categories', reason: e.message });
    }
  }
  if (phone !== undefined) {
    // Google only accepts the primary and additional numbers together, so the additional numbers
    // the profile already has are sent back unchanged.
    const additional: string[] = parse<any>(l.raw_json, {})?.phoneNumbers?.additionalPhones ?? [];
    try {
      await patchLocation(l.id, { phoneNumbers: { primaryPhone: phone, ...(additional.length ? { additionalPhones: additional } : {}) } }, ['phoneNumbers']);
      saved.push('phone number');
      log('basics', 'ok', 'Saved phone number', l.id);
    } catch (e: any) {
      if (e.message === PHONE_BLOCKED_MESSAGE) markPhoneEditBlocked(l.id);
      log('basics', 'error', `phone number: ${e.message}`, l.id);
      if (!saved.length) throw e;
      notSaved.push({ field: 'phone number', reason: e.message });
    }
  }
  if (saved.length) await resync(l.id);
  return { saved, notSaved };
}

/** Changes this app saved to Google for one business, newest first, for the Audit tab. */
export function recentChanges(id: string, limit = 8) {
  return all<{ job: string; status: string; detail: string | null; ran_at: string }>(
    `SELECT job, status, detail, ran_at FROM job_log WHERE location_id = ? AND job IN ('apply', 'basics') ORDER BY id DESC LIMIT ?`,
    id, limit
  );
}
