import { one, run, parse, log } from './db';
import { json as llmJson, hasLLM } from './llm';
import { location, view, isLinked, type LocationRow } from './locations';
import { normName, normPhone, normPostcode, POSTCODE_RE } from './nap';
import { meter, CREDITS } from './usage';

/**
 * Competitor benchmark. Local rankings are a contest: 26 reviews can lead one town and trail in
 * another, so a business is compared with the businesses Google Maps actually shows for the search
 * a customer would type ("electrician in Swindon"). Two pages of Serper Places = 20 businesses for
 * 2 credits, cached per search for a day so every business in the same market shares one lookup.
 *
 * The search phrase matters: J's Electrical ranks 2nd for "Electrical installation service in
 * Swindon" and 4th for "electrician in Swindon". Customers type the second, so the phrase is
 * proposed in everyday words (not Google's category label) and can be edited.
 */
const SERPER = 'https://google.serper.dev';
const CACHE_HOURS = 24;
/** Fewer results than this is not a market to compare against, it is a sign the phrase is wrong. */
export const MIN_RESULTS = 5;

export type Competitor = {
  cid: string; title: string; rating: number | null; ratingCount: number; category: string | null;
  address: string; website: string | null; position: number; isSelf: boolean;
};

export type Benchmark = {
  query: string;
  ranAt: string;
  competitors: Competitor[];
  /** Where the business itself appears in those results; null = not in the first 20. */
  position: number | null;
  total: number;
  thin: boolean;
  self: { reviews: number; rating: number | null };
  stats: {
    /** The first three other businesses Google shows: the local pack a customer sees. */
    packAvgReviews: number | null;
    packAvgRating: number | null;
    medianReviews: number | null;
    medianRating: number | null;
    /** 1 = most reviews among every business in the results, the business itself included. */
    reviewRank: number;
    ratingRank: number | null;
    field: number;
  };
};

export function get(l: Pick<LocationRow, 'benchmark_json'>): Benchmark | null {
  const b = parse<Benchmark | null>(l.benchmark_json, null);
  return b && Array.isArray((b as any).competitors) ? b : null;
}

// ---------------------------------------------------------------- search

async function placesPage(q: string, page: number): Promise<any[]> {
  const key = process.env.SERPER_API_KEY?.trim();
  if (!key) throw new Error('SERPER_API_KEY is not set, so competitors cannot be looked up.');
  meter('serper', { credits: CREDITS.places, kind: 'searches' });
  const res = await fetch(`${SERPER}/places`, {
    method: 'POST', headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, gl: 'gb', hl: 'en', page }),
  });
  if (!res.ok) throw new Error(`Serper places ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j: any = await res.json();
  // Serper reports its own failures as a 200 with a message and no places ("Scraping failed").
  // Treat that as an error to retry, not as a search with no businesses in it.
  if (!Array.isArray(j.places) && j.message) throw new Error(`Google could not be read for "${q}" (${j.message})`);
  return j.places ?? [];
}

/** First 20 Maps results for a search, cached. Serper occasionally returns an empty first page; retry once. */
export async function searchMarket(q: string): Promise<any[]> {
  const key = `places2|${q.trim().toLowerCase()}`;
  const hit = one<{ json: string; fetched_at: string }>('SELECT json, fetched_at FROM serp_cache WHERE key = ?', key);
  if (hit && Date.now() - new Date(hit.fetched_at + 'Z').getTime() < CACHE_HOURS * 3_600_000) return parse<any[]>(hit.json, []);

  // Serper sometimes answers a valid search with nothing, twice running ("roofer in chippenham" came
  // back empty at 0s and 1.5s, then with 10 results a minute later). Back off before believing it.
  let p1: any[] = [];
  let failure: Error | null = null;
  for (const wait of [0, 2000, 5000]) {
    if (wait) await new Promise(r => setTimeout(r, wait));
    try { p1 = await placesPage(q, 1); failure = null; } catch (e: any) { failure = e; p1 = []; }
    if (p1.length) break;
  }
  if (!p1.length && failure) throw failure;   // an error, not an empty market: never cached, retried next run
  const p2 = p1.length >= 10 ? await placesPage(q, 2).catch(() => []) : [];
  const seen = new Set<string>();
  const all = [...p1, ...p2]
    .filter(p => p?.cid && !seen.has(String(p.cid)) && seen.add(String(p.cid)))
    .map((p, i) => ({ ...p, position: i + 1 }));   // Serper restarts `position` on page 2; use our own
  // Never cache an empty answer: it would pin a transient failure in place for a day.
  if (all.length) {
    run(`INSERT INTO serp_cache (key, json, fetched_at) VALUES (?,?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at`, key, JSON.stringify(all));
  }
  return all;
}

// ---------------------------------------------------------------- query

/** "electrician in Swindon", not "Electrical installation service in Swindon". */
export async function proposeQuery(l: LocationRow): Promise<string> {
  const v = view(l);
  const town = v.town || '';
  const primary = v.primaryCategory?.displayName ?? '';
  const fallback = [primary.toLowerCase() || 'local business', town && `in ${town}`].filter(Boolean).join(' ');
  if (!hasLLM() || !town) return fallback;
  try {
    const out = await llmJson<{ query: string }>(
      `You choose the Google Maps search a local customer would type to find a business like this one, so it can be compared with its real competitors.
Rules: the everyday word customers use for the trade or product, then "in <town>". Examples: "electrician in Swindon" (not "electrical installation service"), "garden rooms in Nuneaton" (not "glass merchant"), "builder in Trowbridge", "roofer in Chippenham". Base it on what the business actually sells, which the name often reveals better than Google's category. Trade word in lower case, town capitalised as normal, no quotes.
Return JSON: { "query": string }`,
      `Business name: ${v.title}\nGoogle categories: ${[primary, ...v.additionalCategories.map(c => c.displayName)].filter(Boolean).join(', ') || 'unknown'}\nServices: ${[...v.offeredServices, ...v.serviceNames].slice(0, 12).join(', ') || 'unknown'}\nTown: ${town}`,
    );
    const q = String(out.query ?? '').trim().replace(/^["']|["']$/g, '');
    return q.length >= 4 && q.length <= 80 ? q : fallback;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------- run

function selfFacts(l: LocationRow): { reviews: number; rating: number | null } {
  const pub = parse<any>(l.public_json, null)?.listing;
  if (pub) return { reviews: Number(pub.ratingCount ?? 0), rating: pub.rating ?? null };
  const r = one<{ n: number; avg: number | null }>('SELECT COUNT(*) AS n, AVG(rating) AS avg FROM reviews WHERE location_id = ? AND rating > 0', l.id);
  return { reviews: r?.n ?? 0, rating: r?.avg ? Math.round(r.avg * 10) / 10 : null };
}

export function isSelf(p: any, l: LocationRow): boolean {
  if (l.public_cid && String(p.cid) === l.public_cid) return true;
  const v = view(l);
  const sameName = normName(p.title ?? '', v.town) === normName(v.title, v.town);
  const pc = normPostcode(POSTCODE_RE.exec(p.address ?? '')?.[0] ?? '');
  const samePc = Boolean(pc && v.address.postalCode && pc === normPostcode(v.address.postalCode));
  const samePhone = Boolean(p.phoneNumber && v.phone && normPhone(p.phoneNumber) === normPhone(v.phone));
  return samePhone || (sameName && (samePc || !v.address.postalCode));
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);

export async function runBenchmark(locationId: string, query?: string): Promise<Benchmark> {
  const l = location(locationId);
  if (!l) throw new Error('Unknown location');
  // A phrase passed in or saved earlier (possibly typed by the user) is used as-is; only a freshly
  // proposed one may be swapped for the category fallback below.
  let q = (query ?? '').trim() || l.benchmark_query || '';
  const proposed = !q;
  if (proposed) q = await proposeQuery(l);
  // The phrase is quoted in client reports, so show the town as it is normally written.
  const town = view(l).town;
  if (town) q = q.replace(new RegExp(`\\b${town.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), town);
  let results = await searchMarket(q);
  // A proposed phrase that finds almost nothing is more likely the phrase than the market; try
  // Google's own category before reporting a thin market.
  if (results.length < MIN_RESULTS && proposed) {
    const v = view(l);
    const fallback = v.primaryCategory?.displayName && v.town ? `${v.primaryCategory.displayName.toLowerCase()} in ${v.town}` : '';
    if (fallback && fallback.toLowerCase() !== q.toLowerCase()) {
      const alt = await searchMarket(fallback);
      if (alt.length > results.length) { q = fallback; results = alt; }
    }
  }

  const competitors: Competitor[] = results.map(p => ({
    cid: String(p.cid), title: String(p.title ?? ''), rating: typeof p.rating === 'number' ? p.rating : null,
    ratingCount: Number(p.ratingCount ?? 0), category: p.category ?? null, address: String(p.address ?? ''),
    website: p.website ?? null, position: p.position, isSelf: isSelf(p, l),
  }));
  // Only one row can be "you"; keep the best-ranked if the matcher found several.
  let found = false;
  for (const c of competitors) { if (c.isSelf && found) c.isSelf = false; if (c.isSelf) found = true; }

  const me = competitors.find(c => c.isSelf);
  const self = me ? { reviews: me.ratingCount, rating: me.rating } : selfFacts(l);
  const others = competitors.filter(c => !c.isSelf);
  const pack = others.slice(0, 3);
  const rated = others.filter(c => c.rating != null);
  const b: Benchmark = {
    query: q,
    ranAt: new Date().toISOString(),
    competitors,
    position: me?.position ?? null,
    total: competitors.length,
    thin: competitors.length < MIN_RESULTS,
    self,
    stats: {
      packAvgReviews: pack.length ? Math.round(avg(pack.map(c => c.ratingCount))!) : null,
      packAvgRating: r1(avg(pack.filter(c => c.rating != null).map(c => c.rating!))),
      medianReviews: median(others.map(c => c.ratingCount)),
      medianRating: r1(median(rated.map(c => c.rating!))),
      reviewRank: 1 + others.filter(c => c.ratingCount > self.reviews).length,
      ratingRank: self.rating == null ? null : 1 + rated.filter(c => c.rating! > self.rating!).length,
      field: others.length + 1,
    },
  };
  run(`UPDATE locations SET benchmark_json = ?, benchmark_at = datetime('now'), benchmark_query = ? WHERE id = ?`, JSON.stringify(b), q, locationId);
  log('benchmark', 'ok', `"${q}": ${b.total} results, ${b.position ? `#${b.position}` : 'not in top 20'}, reviews rank ${b.stats.reviewRank}/${b.stats.field}`, locationId);
  return b;
}

/** Before a report or a prospect audit. Never throws: without a benchmark the score falls back to absolute targets. */
export async function ensureBenchmark(locationId: string, maxAgeDays = 7, query?: string): Promise<Benchmark | null> {
  const l = location(locationId);
  if (!l || !process.env.SERPER_API_KEY) return l ? get(l) : null;
  const age = l.benchmark_at ? Date.now() - new Date(l.benchmark_at + 'Z').getTime() : Infinity;
  if (get(l) && age < maxAgeDays * 86_400_000 && (!query || query === l.benchmark_query)) return get(l);
  // A business with no town and no listing has no market to search.
  if (!view(l).town && !isLinked(l)) return get(l);
  try { return await runBenchmark(locationId, query); }
  catch (e: any) { log('benchmark', 'error', e.message, locationId); return get(l); }
}
