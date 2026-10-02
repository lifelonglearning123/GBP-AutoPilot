import { run, parse, log } from './db';
import { location, isLinked, type LocationRow } from './locations';
import { normPhone, normPostcode, normName, hostOf, POSTCODE_RE } from './nap';
import { meter, CREDITS } from './usage';

/**
 * The public Google listing for a business, read through Serper (no Business Profile API needed).
 *
 * Hand-added businesses have no Google data, and the audit used to score "unknown" as "failed":
 * a 5-star, 115-review profile came out as "0 reviews, not verified, no hours". This module pulls
 * what Google shows publicly (categories, hours, rating, review count, place id, map pin, and the
 * recent reviews with whether the owner replied) and makes it the reference for the audit.
 *
 * Costs: /maps = 3 Serper credits, /reviews = 1, /places search = 1–3.
 */
const SERPER = 'https://google.serper.dev';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';

export type Listing = {
  cid: string;
  placeId: string | null;
  title: string;
  address: string;
  phone: string | null;
  website: string | null;
  /** First entry is the primary category. */
  categories: string[];
  hours: Record<string, string> | null;
  rating: number | null;
  ratingCount: number | null;
  latitude: number | null;
  longitude: number | null;
  mapsUrl: string;
};

export type Entered = { title: string; phone: string; website: string; category: string; postcode: string } | null;

export type Snapshot = {
  listing: Listing;
  reviews: { fetched: number; replied: number; recent90: number; unrepliedRecent: number };
  /** What was typed in by hand before the listing was matched; null when created from a link. */
  entered: Entered;
  matchedBy: 'link' | 'search' | 'prospect';
  syncedAt: string;
};

export type Candidate = Listing & { score: number; reasons: string[] };

// ---------------------------------------------------------------- serper

async function serper<T = any>(path: string, body: Record<string, unknown>): Promise<T> {
  const key = process.env.SERPER_API_KEY?.trim();
  if (!key) throw new Error('SERPER_API_KEY is not set in .env.local, so the public Google listing cannot be read.');
  meter('serper', { credits: CREDITS[path] ?? 1, kind: 'public listing' });
  const res = await fetch(`${SERPER}/${path}`, {
    method: 'POST', headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ gl: 'gb', hl: 'en', ...body }),
  });
  if (!res.ok) throw new Error(`Serper ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

function toListing(p: any): Listing {
  const types: string[] = Array.isArray(p.types) ? p.types.filter(Boolean) : [];
  const primary: string = p.type || p.category || types[0] || '';
  const categories = [primary, ...types.filter(t => t !== primary)].filter(Boolean);
  const cid = String(p.cid ?? '');
  return {
    cid,
    placeId: p.placeId ?? null,
    title: String(p.title ?? ''),
    address: String(p.address ?? '').replace(/,?\s*(United Kingdom|UK)\s*$/i, ''),
    phone: p.phoneNumber ?? null,
    website: p.website ?? null,
    categories,
    hours: p.openingHours && typeof p.openingHours === 'object' ? p.openingHours : null,
    rating: typeof p.rating === 'number' ? p.rating : null,
    ratingCount: typeof p.ratingCount === 'number' ? p.ratingCount : null,
    latitude: typeof p.latitude === 'number' ? p.latitude : null,
    longitude: typeof p.longitude === 'number' ? p.longitude : null,
    mapsUrl: cid ? `https://www.google.com/maps?cid=${cid}` : '',
  };
}

/** The full listing (hours, every category, place id) for one business. */
export async function fetchListing(ref: { cid?: string; placeId?: string }): Promise<Listing> {
  if (!ref.cid && !ref.placeId) throw new Error('Need a cid or place id to read a listing');
  const j = await serper<any>('maps', ref.cid ? { cid: ref.cid } : { placeId: ref.placeId });
  const p = j.places?.[0];
  if (!p?.title) throw new Error('Google returned no listing for that link. Check it opens the business in Google Maps.');
  return toListing(p);
}

/** Up to 20 newest reviews, with the owner's reply when there is one. */
export async function fetchReviews(cid: string) {
  const j = await serper<any>('reviews', { cid, sortBy: 'newest' });
  return (j.reviews ?? []).map((r: any) => ({
    id: String(r.id ?? ''),
    rating: Number(r.rating ?? 0),
    text: String(r.snippet ?? ''),
    isoDate: r.isoDate ?? null,
    author: r.user?.name ?? 'A customer',
    reply: r.response?.snippet ?? null,
  })).filter((r: any) => r.id);
}

// ---------------------------------------------------------------- links

export type LinkRef = { cid?: string; placeId?: string; name?: string; kgmid?: string; finalUrl?: string };

/** Decode one URL value: "+" is a space, %26 is "&". Decoded on its own, never as part of the whole URL. */
function decodeValue(v: string): string {
  const spaced = v.replace(/\+/g, ' ');
  try { return decodeURIComponent(spaced); } catch { return spaced; }
}

/**
 * The query string of a URL, read before anything is decoded. Decoding the whole URL first turns
 * "Mortlock+%26+Joyce" into "Mortlock & Joyce", and the "&" then ends the name at "Mortlock".
 */
function queryOf(url: string): Record<string, string> {
  const s = url.trim();
  if (/^https?:\/\//i.test(s)) {
    try { return Object.fromEntries(new URL(s).searchParams); } catch { /* fall through */ }
  }
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/[?&](q|kgmid|cid|ludocid)=([^&#"'\s]+)/g)) if (!(m[1] in out)) out[m[1]] = decodeValue(m[2]);
  return out;
}

/** Pull whatever identifies a business out of a Google Maps / Search URL or page. */
export function parseLink(url: string): LinkRef {
  const ref: LinkRef = {};
  const qs = queryOf(url);
  let u = url;
  try { u = decodeURIComponent(url); } catch { /* keep raw */ }
  // Maps "data" blob carries the feature id "0x…:0x…"; its second half is the cid in hex.
  const fid = /(0x[0-9a-f]{6,}):(0x[0-9a-f]{6,})/i.exec(u);
  if (fid) ref.cid = BigInt(fid[2]).toString();            // cids exceed 2^53, so BigInt, never Number
  const qsCid = /^\d{6,}$/.test(qs.cid ?? '') ? qs.cid : /^\d{6,}$/.test(qs.ludocid ?? '') ? qs.ludocid : undefined;
  const cid = qsCid ? [qsCid, qsCid] : (/[?&](?:cid|ludocid)=(\d{6,})/.exec(u) ?? /"ludocid"\s*:\s*"?(\d{6,})/.exec(u));
  if (!ref.cid && cid) ref.cid = cid[1];
  const pid = /(?:place_id|placeid|query_place_id)[=:]\s*(ChIJ[\w-]{10,})/.exec(u) ?? /\b(ChIJ[\w-]{20,})\b/.exec(u);
  if (pid) ref.placeId = pid[1];
  if (qs.kgmid) ref.kgmid = qs.kgmid;
  // The place name in a Maps path is one path segment, so decode that segment on its own too.
  const place = /\/maps\/place\/([^/@?#]+)/.exec(url);
  const name = place ? decodeValue(place[1]) : qs.q;
  if (name) ref.name = name.replace(/\s+/g, ' ').trim();
  return ref;
}

/**
 * Follow share.google / maps.app.goo.gl / g.page redirects to the page that names the business.
 * A Maps URL gives the cid exactly. A share.google link lands on a Search page with the exact name
 * (and usually the cid embedded in the page); when only the name survives we fall back to a search.
 */
export async function resolveLink(input: string): Promise<LinkRef> {
  let url = input.trim();
  if (!url) throw new Error('Paste a Google Maps or share link');
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const direct = parseLink(url);
  if (direct.cid || direct.placeId) return { ...direct, finalUrl: url };

  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA, 'Accept-Language': 'en-GB,en;q=0.9' } });
  let finalUrl = res.url || url;
  // EU/UK consent interstitial: the real destination is in `continue`.
  if (/consent\.google\./.test(finalUrl)) {
    const cont = new URL(finalUrl).searchParams.get('continue');
    if (cont) finalUrl = cont;
  }
  const ref = { ...direct, ...parseLink(finalUrl), finalUrl };
  if (!ref.cid && !ref.placeId) {
    // The page itself often embeds the ludocid or feature id of the knowledge panel.
    const html = await res.text().catch(() => '');
    const inPage = parseLink(html.slice(0, 600_000));
    if (inPage.cid) ref.cid = inPage.cid;
    else if (inPage.placeId) ref.placeId = inPage.placeId;
  }
  if (!ref.cid && !ref.placeId && !ref.name) throw new Error('That link did not lead to a Google business. Open the business in Google Maps and copy the link from there.');
  return ref;
}

// ---------------------------------------------------------------- matching

export async function searchListings(query: string): Promise<Listing[]> {
  const j = await serper<any>('places', { q: query });
  return (j.places ?? []).map(toListing).filter((l: Listing) => l.cid);
}

type Want = { name: string; town?: string; postcode?: string; phone?: string };

export function score(c: Listing, w: Want): Candidate {
  const reasons: string[] = [];
  let s = 0;
  const a = normName(w.name, w.town), b = normName(c.title, w.town);
  if (a && a === b) { s += 50; reasons.push('same name'); }
  else if (a && b && (a.includes(b) || b.includes(a))) { s += 35; reasons.push('similar name'); }
  const pc = w.postcode ? normPostcode(w.postcode) : '';
  const cpc = normPostcode(POSTCODE_RE.exec(c.address)?.[0] ?? '');
  if (pc && cpc && pc === cpc) { s += 30; reasons.push('same postcode'); }
  if (w.phone && c.phone && normPhone(w.phone) === normPhone(c.phone)) { s += 30; reasons.push('same phone'); }
  if (w.town && c.address.toLowerCase().includes(w.town.toLowerCase())) { s += 10; reasons.push('same town'); }
  return { ...c, score: s, reasons };
}

/** Candidates for a business, best first. Confident = name agrees AND postcode or phone agrees. */
export async function findCandidates(w: Want): Promise<{ candidates: Candidate[]; confident: Candidate | null }> {
  const q = [w.name, w.town].filter(Boolean).join(' ');
  const scored = (await searchListings(q)).map(c => score(c, w)).sort((x, y) => y.score - x.score);
  const top = scored[0];
  const nameOk = top && top.reasons.some(r => r === 'same name' || r === 'similar name');
  const anchor = top && top.reasons.some(r => r === 'same postcode' || r === 'same phone');
  const unique = top && (scored.length < 2 || scored[1].score < top.score);
  return { candidates: scored.slice(0, 6), confident: top && nameOk && anchor && unique ? top : null };
}

/**
 * Link → listing preview, without touching the database. `exact` is true only when the link carried
 * the business's own id. A link that only carried the name is matched to a listing with that name,
 * and never to "the first search result": that is how a Mortlock & Joyce link once became Mortlock
 * Timber. No listing with the name means an error listing the closest names, not a guess.
 */
export async function lookup(url: string): Promise<{ listing: Listing; exact: boolean }> {
  const ref = await resolveLink(url);
  if (ref.cid || ref.placeId) return { listing: await fetchListing(ref), exact: true };
  const want = ref.name!;
  const hits = await searchListings(want);
  const w = normName(want);
  const same = hits.filter(h => normName(h.title) === w);
  // Google often shortens a listing name in results ("Mortlock & Joyce" for the full trading name),
  // so one listing whose name contains, or is contained in, the wanted name also counts.
  const close = hits.filter(h => { const n = normName(h.title); return n && w && (n.includes(w) || w.includes(n)); });
  const pick = same.length === 1 ? same[0] : same.length === 0 && close.length === 1 ? close[0] : null;
  if (!pick) {
    const names = [...new Set(hits.map(h => h.title))].slice(0, 4);
    throw new Error(
      `The link only gave the business name, “${want}”, and ${same.length > 1 ? 'more than one listing has that name' : 'no listing matches it closely enough'}` +
      `${names.length ? ` (closest: ${names.join('; ')})` : ''}. Open the business in Google Maps and paste that link instead: it identifies the business exactly.`
    );
  }
  return { listing: await fetchListing({ cid: pick.cid }), exact: false };
}

// ---------------------------------------------------------------- write

export function snapshot(l: Pick<LocationRow, 'public_json'>): Snapshot | null {
  const s = parse<Snapshot | null>(l.public_json, null);
  return s && (s as any).listing ? s : null;
}

/** Split "30 Commercial Rd, Swindon SN1 5NS" into street / town / postcode. */
export function parseAddress(address: string) {
  const clean = String(address ?? '').replace(/,?\s*(United Kingdom|UK|England|Scotland|Wales)\s*$/i, '').trim();
  const pc = POSTCODE_RE.exec(clean)?.[0]?.toUpperCase().replace(/\s*(\d[A-Z]{2})$/, ' $1') ?? '';
  const segs = clean.split(',').map(s => s.trim()).filter(Boolean);
  let idx = segs.findIndex(s => pc && s.toUpperCase().includes(pc.replace(' ', '')) || (pc && s.toUpperCase().includes(pc)));
  if (idx < 0) idx = segs.length - 1;
  let town = (segs[idx] ?? '').replace(POSTCODE_RE, '').trim();
  let streetEnd = idx;
  if (!town && idx > 0) { town = segs[idx - 1]; streetEnd = idx - 1; }
  return { street: segs.slice(0, streetEnd).join(', '), town, postcode: pc };
}

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

function parseTime(s: string, meridiem?: string): { hours: number; minutes?: number; m?: string } | null {
  const m = /(\d{1,2})(?::(\d{2}))?\s*([AP]M)?/i.exec(s.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const mer = (m[3] ?? meridiem ?? '').toUpperCase();
  if (mer === 'PM' && h < 12) h += 12;
  if (mer === 'AM' && h === 12) h = 0;
  return { hours: h, ...(m[2] ? { minutes: Number(m[2]) } : {}), m: m[3]?.toUpperCase() };
}

/** Google's "8 AM–5 PM" strings into the Business Profile periods shape the rest of the app reads. */
export function parseHours(h: Record<string, string> | null) {
  const periods: any[] = [];
  for (const [day, raw] of Object.entries(h ?? {})) {
    const D = day.toUpperCase();
    if (!DAYS.includes(D)) continue;
    const val = String(raw);
    if (/closed/i.test(val)) continue;
    if (/24 hours/i.test(val)) { periods.push({ openDay: D, openTime: { hours: 0 }, closeDay: D, closeTime: { hours: 24 } }); continue; }
    for (const range of val.split(/,|\band\b/)) {
      const [a, b] = range.split(/[–—-]/);
      if (!a || !b) continue;
      const end = parseTime(b);
      if (!end) continue;
      let start = parseTime(a, end.m);
      if (start && start.hours > end.hours && !/[ap]m/i.test(a)) start = parseTime(a, 'AM');
      if (!start) continue;
      const strip = ({ m, ...t }: any) => t;
      periods.push({ openDay: D, openTime: strip(start), closeDay: D, closeTime: strip(end) });
    }
  }
  return { periods };
}

const catName = (display: string) => `categories/gcid:${display.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;

/**
 * Read the public listing and reviews and make them the reference for this business: name, phone,
 * address, hours, categories, place id and map pin are overwritten from Google, recent reviews are
 * stored, and whatever had been typed in by hand is kept aside so differences can be reported.
 */
export async function enrich(locationId: string, opts: { cid: string; matchedBy: Snapshot['matchedBy']; captureEntered?: boolean }): Promise<Snapshot> {
  const l = location(locationId);
  if (!l) throw new Error('Unknown location');
  if (isLinked(l)) throw new Error('This business is connected through the Business Profile API, which is the better source; public enrichment is only for hand-added businesses.');

  const listing = await fetchListing({ cid: opts.cid });
  const reviews = await fetchReviews(opts.cid).catch(e => { log('public', 'error', `reviews: ${e.message}`, locationId); return []; });

  const prev = snapshot(l);
  const addr0 = parse<any>(l.address_json, {});
  const cats0 = parse<any>(l.categories_json, {});
  const entered: Entered = prev ? prev.entered
    : opts.captureEntered
      ? { title: l.title, phone: l.phone ?? '', website: l.website ?? '', category: cats0?.primaryCategory?.displayName ?? '', postcode: addr0?.postalCode ?? '' }
      : null;

  const a = parseAddress(listing.address);
  const address = {
    regionCode: 'GB', postalCode: a.postcode || addr0?.postalCode || undefined, locality: a.town || addr0?.locality || undefined,
    administrativeArea: addr0?.administrativeArea || undefined, addressLines: a.street ? [a.street] : (addr0?.addressLines ?? []),
  };
  const [primary, ...extra] = listing.categories;
  const categories = primary ? {
    primaryCategory: { name: catName(primary), displayName: primary },
    additionalCategories: extra.map(c => ({ name: catName(c), displayName: c })),
  } : cats0;

  const now = Date.now();
  const recent90 = reviews.filter((r: any) => r.isoDate && now - new Date(r.isoDate).getTime() <= 90 * 86_400_000);
  const snap: Snapshot = {
    listing,
    reviews: {
      fetched: reviews.length,
      replied: reviews.filter((r: any) => r.reply).length,
      recent90: recent90.length,
      unrepliedRecent: recent90.filter((r: any) => !r.reply).length,
    },
    entered,
    matchedBy: opts.matchedBy,
    syncedAt: new Date().toISOString(),
  };

  run(
    `UPDATE locations SET title = ?, phone = ?, website = ?, address_json = ?, latlng_json = ?, hours_json = ?, categories_json = ?,
       place_id = ?, maps_uri = ?, new_review_uri = ?, public_cid = ?, public_json = ?, public_synced_at = datetime('now') WHERE id = ?`,
    listing.title || l.title,
    listing.phone ?? l.phone,
    listing.website ?? l.website,
    JSON.stringify(address),
    JSON.stringify(listing.latitude != null ? { latitude: listing.latitude, longitude: listing.longitude } : null),
    JSON.stringify(listing.hours ? parseHours(listing.hours) : null),
    JSON.stringify(categories),
    listing.placeId,
    listing.mapsUrl || null,
    listing.placeId ? `https://search.google.com/local/writereview?placeid=${listing.placeId}` : null,
    listing.cid,
    JSON.stringify(snap),
    locationId,
  );

  // Keyed by the business as well as by Google's review id. Keyed by the review id alone, the same
  // listing added twice (two prospect searches of one town) left the second copy with no reviews
  // at all, because every row already existed under the first. Rows stored the old way are
  // replaced; they are a snapshot of the public listing, read again here.
  run(`DELETE FROM reviews WHERE location_id = ? AND id NOT LIKE ?`, locationId, `${locationId}:%`);
  for (const r of reviews.map((x: any) => ({ ...x, id: `${locationId}:${x.id}` }))) {
    run(
      `INSERT INTO reviews (id, location_id, reviewer, rating, comment, create_time, update_time, reply_comment, draft_status)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET rating = excluded.rating, comment = excluded.comment, reply_comment = excluded.reply_comment,
         draft_status = CASE WHEN excluded.reply_comment IS NOT NULL THEN 'posted' ELSE reviews.draft_status END, fetched_at = datetime('now')`,
      r.id, locationId, r.author, r.rating, r.text, r.isoDate, r.isoDate, r.reply, r.reply ? 'posted' : 'none',
    );
  }
  log('public', 'ok', `${listing.title}: ${listing.rating ?? '-'}★ (${listing.ratingCount ?? 0}), ${listing.categories.length} categories, ${reviews.length} reviews read`, locationId);
  return snap;
}

/**
 * Before an audit or report on a hand-added business: refresh the public data if it is missing or
 * older than `maxAgeHours`. With no cid yet, try a confident search match. Never throws: an audit
 * without public data still runs, it just scores fewer checks.
 */
export async function ensureFresh(locationId: string, maxAgeHours = 24): Promise<Snapshot | null> {
  const l = location(locationId);
  if (!l || isLinked(l) || !process.env.SERPER_API_KEY) return l ? snapshot(l) : null;
  const snap = snapshot(l);
  const age = l.public_synced_at ? Date.now() - new Date(l.public_synced_at + 'Z').getTime() : Infinity;
  try {
    if (l.public_cid) {
      if (age < maxAgeHours * 3_600_000) return snap;
      return await enrich(locationId, { cid: l.public_cid, matchedBy: snap?.matchedBy ?? 'search' });
    }
    const addr = parse<any>(l.address_json, {});
    const { confident } = await findCandidates({ name: l.title, town: addr?.locality, postcode: addr?.postalCode, phone: l.phone ?? undefined });
    if (confident) return await enrich(locationId, { cid: confident.cid, matchedBy: 'search', captureEntered: true });
  } catch (e: any) {
    log('public', 'error', e.message, locationId);
  }
  return snap;
}

export async function candidatesFor(locationId: string): Promise<Candidate[]> {
  const l = location(locationId);
  if (!l) throw new Error('Unknown location');
  const addr = parse<any>(l.address_json, {});
  const e = snapshot(l)?.entered;
  return (await findCandidates({
    name: e?.title || l.title, town: addr?.locality, postcode: e?.postcode || addr?.postalCode, phone: e?.phone || l.phone || undefined,
  })).candidates;
}

/** Point an existing hand-added business at a listing, from a pasted link or a picked candidate. */
export async function link(locationId: string, ref: { url?: string; cid?: string }): Promise<Snapshot> {
  let cid = ref.cid;
  let byLink = false;
  if (!cid && ref.url) {
    const found = await lookup(ref.url);
    cid = found.listing.cid;
    byLink = found.exact;
  }
  if (!cid) throw new Error('Paste a Google Maps or share link, or pick a listing');
  // Only a link that carried the business's own id counts as an exact link match; a match made from
  // the name alone is recorded as a search match, so the panel asks for a check.
  return enrich(locationId, { cid, matchedBy: byLink ? 'link' : 'search', captureEntered: true });
}

export function unlink(locationId: string) {
  run(`UPDATE locations SET public_cid = NULL, public_json = NULL, public_synced_at = NULL WHERE id = ?`, locationId);
}

/** Where the details typed in differ from what Google shows. Each one is a real NAP finding. */
export function enteredDiffs(l: LocationRow): { field: string; entered: string; google: string }[] {
  const s = snapshot(l);
  if (!s?.entered) return [];
  const e = s.entered, g = s.listing;
  const out: { field: string; entered: string; google: string }[] = [];
  if (e.phone && g.phone && normPhone(e.phone) !== normPhone(g.phone)) out.push({ field: 'Phone', entered: e.phone, google: g.phone });
  if (e.website && g.website && hostOf(e.website) !== hostOf(g.website)) out.push({ field: 'Website', entered: e.website, google: g.website });
  const gpc = POSTCODE_RE.exec(g.address)?.[0] ?? '';
  if (e.postcode && gpc && normPostcode(e.postcode) !== normPostcode(gpc)) out.push({ field: 'Postcode', entered: e.postcode, google: gpc.toUpperCase() });
  if (e.title && g.title && normName(e.title) !== normName(g.title)) out.push({ field: 'Name', entered: e.title, google: g.title });
  if (e.category && g.categories[0] && e.category.toLowerCase() !== g.categories[0].toLowerCase()) out.push({ field: 'Primary category', entered: e.category, google: g.categories[0] });
  return out;
}
