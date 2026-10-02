import { all, one, run, parse, log } from './db';
import { json as llmJson, hasLLM } from './llm';
import { location, view, updateConfig, type LocationRow } from './locations';
import { searchMarket, proposeQuery, isSelf, MIN_RESULTS } from './benchmark';
import { fetchListing } from './public';
import { normName } from './nap';
import { meter, CREDITS } from './usage';

/**
 * Multi-keyword local visibility. One search hides most of the picture: J's Electrical is 1st for
 * "consumer unit replacement Swindon", 3rd for "electrician in Swindon" and nowhere for "air
 * conditioning installation Swindon", despite listing air conditioning as a Google category.
 *
 * Per business: a list of customer searches (suggested from services, categories and Google
 * autocomplete, editable), each checked on Google Maps (first 20, cached per phrase for a day so a
 * whole town shares one lookup), an intent check (does this search return businesses like this one
 * at all?), a share-of-local-search number for the business and every competitor that appears,
 * and the gaps that explain why the leaders lead. Every run is stored so progress can be shown.
 *
 * Not here yet: the map grid (rank from points around the business). Serper's /places ignores a
 * searcher location; /maps honours `ll` at 3 credits a call, which is what that feature will use.
 */
const SERPER = 'https://google.serper.dev';
export const DEFAULT_TRACKED = 8;
const PROFILE_DAYS = 7;

export type KeywordRow = {
  id: number; location_id: string; phrase: string; source: string; active: number;
  intent: string | null; intent_note: string | null; suggestion: string | null; created_at: string;
};
export type Hit = { cid: string; title: string; rating: number | null; ratingCount: number; category: string | null; position: number; isSelf: boolean };
export type RankRow = {
  id: number; run_id: number; location_id: string; keyword_id: number | null; phrase: string;
  position: number | null; total: number; intent: 'ok' | 'wrong' | 'thin' | 'error'; note: string | null; results_json: string | null;
};
export type RunRow = { id: number; location_id: string; ran_at: string; keywords: number; visibility: number | null; summary_json: string | null };
export type Leader = { cid: string; title: string; share: number; reviews: number; rating: number | null; top3: number; appearances: number; isSelf: boolean };
export type Gap = { type: 'category' | 'weak' | 'reviews' | 'intent'; keyword?: string; text: string };
export type RunSummary = {
  visibility: number; scored: number; total: number;
  /** Position among every business that appeared in any scored search (the leaderboard is cut to 10). */
  rank?: number | null; field?: number;
  leaderboard: Leader[];
  gaps: Gap[];
  categories: { self: string[]; missing: { name: string; count: number }[] };
};

// ---------------------------------------------------------------- visibility

/**
 * Points by Maps position. The first three are the local pack most customers call, so they carry
 * most of the weight; 11th to 20th is barely seen. Share of local search = average points across
 * the searches, so 100% means first for every one.
 */
const POINTS = [100, 70, 50, 30, 25, 20, 16, 13, 11, 10];
export function visibilityPoints(pos: number | null): number {
  if (!pos) return 0;
  if (pos <= 10) return POINTS[pos - 1];
  return pos <= 20 ? 3 : 0;
}

// ---------------------------------------------------------------- keyword list

export function keywords(locationId: string): KeywordRow[] {
  return all<KeywordRow>('SELECT * FROM keywords WHERE location_id = ? ORDER BY active DESC, id', locationId);
}
const activeKeywords = (locationId: string) => keywords(locationId).filter(k => k.active);

/** Show the town as it is normally written; phrases are quoted in client reports. */
function tidy(phrase: string, town: string): string {
  let p = phrase.replace(/\s+/g, ' ').trim().replace(/^["']|["']$/g, '');
  if (town) p = p.replace(new RegExp(`\\b${town.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), town);
  return p;
}

export function addKeyword(locationId: string, phrase: string, source = 'manual', active = true): KeywordRow {
  const l = location(locationId);
  if (!l) throw new Error('Unknown location');
  const p = tidy(phrase, view(l).town);
  if (p.length < 3) throw new Error('Type the search a customer would use, for example "roofer in Chippenham".');
  const existing = one<KeywordRow>('SELECT * FROM keywords WHERE location_id = ? AND lower(phrase) = lower(?)', locationId, p);
  if (existing) {
    if (active && !existing.active) run('UPDATE keywords SET active = 1 WHERE id = ?', existing.id);
    return one<KeywordRow>('SELECT * FROM keywords WHERE id = ?', existing.id)!;
  }
  const r = run('INSERT INTO keywords (location_id, phrase, source, active) VALUES (?,?,?,?)', locationId, p, source, active ? 1 : 0);
  return one<KeywordRow>('SELECT * FROM keywords WHERE id = ?', Number(r.lastInsertRowid))!;
}
export function setActive(id: number, active: boolean) { run('UPDATE keywords SET active = ? WHERE id = ?', active ? 1 : 0, id); }
export function removeKeyword(id: number) { run('DELETE FROM keywords WHERE id = ?', id); }
/** Swap a wrong-intent phrase for the suggested one. */
export function useSuggestion(id: number) {
  const k = one<KeywordRow>('SELECT * FROM keywords WHERE id = ?', id);
  if (!k?.suggestion) throw new Error('No suggested phrase for this search');
  const clash = one<KeywordRow>('SELECT id FROM keywords WHERE location_id = ? AND lower(phrase) = lower(?) AND id != ?', k.location_id, k.suggestion, id);
  if (clash) { run('DELETE FROM keywords WHERE id = ?', id); setActive(clash.id, true); return; }
  run(`UPDATE keywords SET phrase = ?, source = 'suggested', intent = NULL, intent_note = NULL, suggestion = NULL WHERE id = ?`, k.suggestion, id);
}

// ---------------------------------------------------------------- suggestions

async function autocomplete(q: string): Promise<string[]> {
  const key = process.env.SERPER_API_KEY?.trim();
  if (!key) return [];
  try {
    meter('serper', { credits: CREDITS.autocomplete, kind: 'search suggestions' });
    const res = await fetch(`${SERPER}/autocomplete`, {
      method: 'POST', headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, gl: 'gb', hl: 'en' }),
    });
    if (!res.ok) return [];
    return (((await res.json()) as any).suggestions ?? []).map((s: any) => String(s.value ?? '')).filter(Boolean);
  } catch { return []; }
}

/**
 * The searches customers use for what this business actually does. Google autocomplete gives real
 * phrasing but also noise ("electrician jobs", "courses", other towns), so the model picks and
 * cleans a list from the categories, services and autocomplete together. The first eight are
 * tracked; the rest wait as suggestions to tick.
 */
export async function suggestKeywords(locationId: string): Promise<KeywordRow[]> {
  const l = location(locationId);
  if (!l) throw new Error('Unknown location');
  const v = view(l);
  if (!v.town) throw new Error('This business has no town, so there is no local search to track.');
  if (!hasLLM()) throw new Error('Suggesting searches needs an LLM key.');

  const primary = tidy(l.benchmark_query || (await proposeQuery(l)), v.town);
  const trade = primary.replace(new RegExp(`\\s*(in\\s+)?${v.town}\\s*$`, 'i'), '').trim() || primary;
  const services = [...new Set([...v.offeredServices, ...v.serviceNames])];
  const seeds = [...new Set([`${trade} ${v.town}`, ...services.slice(0, 2).map(s => `${s} ${v.town}`)])].slice(0, 3);
  const auto = [...new Set((await Promise.all(seeds.map(autocomplete))).flat())];
  const categories = [v.primaryCategory?.displayName, ...v.additionalCategories.map(c => c.displayName)].filter(Boolean) as string[];

  const out = await llmJson<{ keywords: { phrase: string; source: string }[] }>(
    `You choose the Google Maps searches that local customers use to find a business like this one, so its rankings can be tracked.
Rules:
- Each phrase is something a customer would type into Google Maps for work this business genuinely does, in everyday words, with the town: "<service> in <Town>" or "<service> <Town>".
- Cover: the main trade; the most important services; each Google category the business holds (these are claims worth testing). Most important first.
- Say "installer", "fitter" or "company" when the plain phrase would return places rather than businesses (for example "EV charger installer", not "EV charger installation", which returns charging stations).
- Leave out the business's own name (searching for it by name says nothing about competitors), jobs, apprenticeships, courses, training, DIY, price or cost questions, other towns, other countries, and near-duplicates.
- 10 to 12 phrases. Source is one of: primary, category, service, autocomplete.
Return JSON: { "keywords": [{ "phrase": string, "source": string }] }`,
    [
      `Business: ${v.title}`,
      `Town: ${v.town}`,
      `Main search already in use: ${primary}`,
      `Google categories: ${categories.join(', ') || 'unknown'}`,
      `Services: ${services.slice(0, 20).join(', ') || 'unknown'}`,
      `Google autocomplete for ${seeds.map(s => `"${s}"`).join(', ')}: ${auto.join(' | ') || 'none'}`,
    ].join('\n'),
  );

  const list = [{ phrase: primary, source: 'primary' }, ...(out.keywords ?? [])]
    .map(k => ({ phrase: tidy(String(k.phrase ?? ''), v.town), source: ['primary', 'category', 'service', 'autocomplete'].includes(k.source) ? k.source : 'suggested' }))
    .filter(k => k.phrase.length >= 4 && k.phrase.length <= 90)
    // A search for the business's own name only ever finds the business itself.
    .filter(k => { const brand = normName(v.title, v.town); return !(brand.length >= 6 && normName(k.phrase, v.town).includes(brand)); });

  let activeCount = activeKeywords(locationId).length;
  for (const k of list) {
    const exists = one('SELECT id FROM keywords WHERE location_id = ? AND lower(phrase) = lower(?)', locationId, k.phrase);
    if (exists) continue;
    const on = activeCount < DEFAULT_TRACKED;
    addKeyword(locationId, k.phrase, k.source, on);
    if (on) activeCount++;
  }
  log('keywords', 'ok', `suggested ${list.length} searches (${auto.length} autocomplete hints)`, locationId);
  return keywords(locationId);
}

// ---------------------------------------------------------------- competitor profiles

type Profile = { cid: string; title: string; categories: string[]; rating: number | null; ratingCount: number; website: string | null };

async function profile(cid: string): Promise<Profile | null> {
  const hit = one<{ json: string; fetched_at: string }>('SELECT json, fetched_at FROM competitor_profiles WHERE cid = ?', cid);
  if (hit && Date.now() - new Date(hit.fetched_at + 'Z').getTime() < PROFILE_DAYS * 86_400_000) return parse<Profile | null>(hit.json, null);
  try {
    const L = await fetchListing({ cid });
    const p: Profile = { cid, title: L.title, categories: L.categories, rating: L.rating, ratingCount: L.ratingCount ?? 0, website: L.website };
    run(`INSERT INTO competitor_profiles (cid, json, fetched_at) VALUES (?,?, datetime('now'))
         ON CONFLICT(cid) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at`, cid, JSON.stringify(p));
    return p;
  } catch {
    return hit ? parse<Profile | null>(hit.json, null) : null;
  }
}

// ---------------------------------------------------------------- intent

type IntentCheck = { phrase: string; intent: 'ok' | 'wrong'; note: string; better: string };

/**
 * One call for every search where the business itself did not appear: are the results businesses
 * of the same kind (competitors), or something else? "EV charger installation Swindon" returns
 * public charging stations, which says nothing about an electrician's visibility.
 */
async function checkIntent(l: LocationRow, rows: { phrase: string; hits: Hit[] }[]): Promise<Map<string, IntentCheck>> {
  const out = new Map<string, IntentCheck>();
  if (!rows.length || !hasLLM()) return out;
  const v = view(l);
  const cats = [v.primaryCategory?.displayName, ...v.additionalCategories.map(c => c.displayName)].filter(Boolean).join(', ');
  const describe = (hits: Hit[]) => {
    const counts = new Map<string, number>();
    for (const h of hits.slice(0, 10)) counts.set(h.category ?? 'unknown', (counts.get(h.category ?? 'unknown') ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ×${n}`).join(', ');
  };
  try {
    const res = await llmJson<{ checks: IntentCheck[] }>(
      `For each Google Maps search, decide whether the results are businesses of the same kind as this business (its competitors for that work) or something else.
"ok": the results are mostly businesses a customer would hire for this work, even if more specialised than this business.
"wrong": the results are a different kind of place, for example public EV charging stations when the business installs chargers, retail shops when it is a trade, or training providers.
For "wrong", "better" is a clearer phrase with the town that would return businesses like this one (for example "EV charger installer in Swindon"); otherwise an empty string. "note" is a short plain description of what the results are.
Return JSON: { "checks": [{ "phrase": string, "intent": "ok"|"wrong", "note": string, "better": string }] }`,
      `Business: ${v.title}\nIts Google categories: ${cats || 'unknown'}\n\n` +
        rows.map(r => `Search: ${r.phrase}\nTop result categories: ${describe(r.hits) || 'none'}`).join('\n\n'),
    );
    for (const c of res.checks ?? []) {
      if (!c?.phrase) continue;
      out.set(String(c.phrase).toLowerCase(), {
        phrase: c.phrase, intent: c.intent === 'wrong' ? 'wrong' : 'ok', note: String(c.note ?? ''), better: String(c.better ?? '').trim(),
      });
    }
  } catch (e: any) {
    log('keywords', 'error', `intent check: ${e.message}`, l.id);
  }
  return out;
}

// ---------------------------------------------------------------- gaps

/** Words that say nothing about which service a search or category is about. */
const GENERIC = new Set(['install', 'installation', 'installer', 'installers', 'repair', 'repairs', 'replacement', 'service', 'services',
  'contractor', 'contractors', 'company', 'companies', 'specialist', 'specialists', 'local', 'best', 'cheap', 'near', 'fitting',
  'fitter', 'fitters', 'shop', 'store', 'supplier', 'suppliers', 'equipment', 'system', 'systems', 'emergency', 'professional']);
const stem = (w: string) => w.replace(/(ers|er|ing|ion|s)$/, '');
/** Google's catch-all place types; nobody chooses them and they rank for nothing. */
const CATCH_ALL = new Set(['service establishment', 'establishment', 'point of interest', 'corporate office', 'business', 'store', 'shop', 'local business']);
function topicWords(s: string, town: string): Set<string> {
  const t = town.toLowerCase();
  return new Set(s.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3 && w !== t && !GENERIC.has(w)).map(stem));
}

function findGaps(l: LocationRow, rows: { phrase: string; intent: string; note: string; better: string; position: number | null; hits: Hit[] }[],
  top: Profile[], selfCats: string[]): { gaps: Gap[]; missing: { name: string; count: number }[] } {
  const v = view(l);
  const gaps: Gap[] = [];
  const own = new Set(selfCats.map(c => c.toLowerCase()));

  // 1. Categories the most visible competitors share and this business does not claim.
  const counts = new Map<string, { name: string; count: number }>();
  for (const p of top) for (const c of new Set(p.categories)) {
    const k = c.toLowerCase();
    if (!own.has(k) && !CATCH_ALL.has(k)) counts.set(k, { name: c, count: (counts.get(k)?.count ?? 0) + 1 });
  }
  const missing = [...counts.values()].filter(m => m.count >= 2).sort((a, b) => b.count - a.count).slice(0, 5);
  for (const m of missing) {
    gaps.push({ type: 'category', text: `${m.count} of the ${top.length} most visible competitors list "${m.name}" as a Google category; this business does not. Add it if the business genuinely does this work.` });
  }

  // 2. Searches where it is outside the top 10, noting when it already claims a matching category.
  const selfReviews = (rows.flatMap(r => r.hits).find(h => h.isSelf)?.ratingCount) ?? 0;
  for (const r of rows.filter(r => r.intent === 'ok' && (!r.position || r.position > 10))) {
    const words = topicWords(r.phrase, v.town);
    // "electrical supply store" should point at "Electrical supply store", not the primary
    // "Electrical installation service" that merely shares the word "electrical".
    const claimed = selfCats
      .map(c => ({ c, n: [...topicWords(c, v.town)].filter(w => words.has(w)).length }))
      .filter(x => x.n > 0)
      .sort((a, b) => b.n - a.n)[0]?.c;
    const lead = r.hits.find(h => !h.isSelf);
    gaps.push({
      type: 'weak', keyword: r.phrase,
      text: `${r.position ? `#${r.position}` : 'Not in the top 20'} for "${r.phrase}"` +
        (claimed ? ` despite listing "${claimed}" as a category, so the category alone is not enough.` : '.') +
        (lead ? ` ${lead.title} leads with ${lead.ratingCount} reviews.` : ''),
    });
  }

  // 3. Searches where it is close (4th to 10th) but well behind the top three on reviews.
  for (const r of rows.filter(r => r.intent === 'ok' && r.position && r.position >= 4 && r.position <= 10)) {
    const pack = r.hits.filter(h => !h.isSelf).slice(0, 3);
    if (!pack.length) continue;
    const avg = Math.round(pack.reduce((s, h) => s + h.ratingCount, 0) / pack.length);
    if (selfReviews < avg * 0.7) gaps.push({ type: 'reviews', keyword: r.phrase, text: `#${r.position} for "${r.phrase}". The three shown first average ${avg} reviews against this business's ${selfReviews}.` });
  }

  // 4. Searches that return the wrong kind of business.
  for (const r of rows.filter(r => r.intent === 'wrong')) {
    gaps.push({ type: 'intent', keyword: r.phrase, text: `"${r.phrase}" returns ${r.note || 'a different kind of business'}, so it is left out of the share.${r.better ? ` Try "${r.better}".` : ''}` });
  }
  return { gaps: gaps.slice(0, 10), missing };
}

// ---------------------------------------------------------------- run

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

/** After a check in which every search failed, the scheduler waits this long before trying again. */
const RETRY_FAILED_SEARCHES_HOURS = 6;

export async function runKeywords(locationId: string): Promise<RunSummary> {
  const l = location(locationId);
  if (!l) throw new Error('Unknown location');
  if (!process.env.SERPER_API_KEY) throw new Error('SERPER_API_KEY is not set, so searches cannot be checked.');
  let kws = activeKeywords(locationId);
  if (!kws.length) { await suggestKeywords(locationId); kws = activeKeywords(locationId); }
  if (!kws.length) throw new Error('No searches to check yet. Add one or click Suggest searches.');
  const v = view(l);

  // 1. Search each phrase (cached per phrase for a day, shared across businesses).
  const searched = await pool(kws, 3, async kw => {
    let places: any[] = [];
    let failed = '';
    try { places = await searchMarket(kw.phrase); } catch (e: any) { failed = e.message; log('keywords', 'error', `"${kw.phrase}": ${e.message}`, locationId); }
    let seen = false;
    const hits: Hit[] = places.map(p => {
      const me = !seen && isSelf(p, l);
      if (me) seen = true;
      return { cid: String(p.cid), title: String(p.title ?? ''), rating: typeof p.rating === 'number' ? p.rating : null, ratingCount: Number(p.ratingCount ?? 0), category: p.category ?? null, position: p.position, isSelf: me };
    });
    return { kw, hits, failed, position: hits.find(h => h.isSelf)?.position ?? null };
  });

  // Every search failing is an outage, not a result. It used to be stored as a run with a share of
  // 0% and the next check put a week away. Nothing is stored, and it is tried again in a few hours.
  if (searched.every(s => s.failed)) {
    updateConfig(locationId, { next_keywords_at: new Date(Date.now() + RETRY_FAILED_SEARCHES_HOURS * 3_600_000).toISOString() });
    throw new Error(`Google could not be read for any of the ${searched.length} searches (${searched[0].failed}), so nothing was recorded. Try again later.`);
  }

  // 2. Intent: thin results are skipped; appearing yourself proves the search is yours; the rest are
  // judged by the model ONCE and the verdict reused. Re-asking every week let the same search flip
  // between "ok" and "wrong", which moved the share with nothing real changing. Editing a phrase
  // (or using a suggested one) clears the verdict so it is judged afresh.
  const judged = (k: KeywordRow) => k.intent === 'ok' || k.intent === 'wrong';
  const unsure = searched.filter(s => !s.failed && s.hits.length >= MIN_RESULTS && !s.position && !judged(s.kw));
  const checks = await checkIntent(l, unsure.map(s => ({ phrase: s.kw.phrase, hits: s.hits })));
  const rows = searched.map(s => {
    const c = checks.get(s.kw.phrase.toLowerCase());
    const prior = judged(s.kw) ? (s.kw.intent as 'ok' | 'wrong') : null;
    // A search that needed judging and got no verdict (the model was down) is not "ok". It used to
    // default to ok and be stored as the permanent judgement, never asked again. It is left out of
    // this run and judged on the next.
    const unjudged = !s.failed && s.hits.length >= MIN_RESULTS && !s.position && !c && !prior;
    const intent: 'ok' | 'wrong' | 'thin' | 'error' = s.failed || unjudged ? 'error' : s.hits.length < MIN_RESULTS ? 'thin' : s.position ? 'ok' : c?.intent ?? prior ?? 'ok';
    const note = unjudged ? 'This search could not be judged this time; it is judged on the next run'
      : intent === 'error' ? 'Google could not be read for this search; it is retried on the next run'
      : intent === 'thin' ? `only ${s.hits.length} result${s.hits.length === 1 ? '' : 's'}`
      : c?.note ?? (intent === 'wrong' ? s.kw.intent_note ?? '' : '');
    return { ...s, phrase: s.kw.phrase, intent, note, better: intent === 'wrong' ? c?.better ?? s.kw.suggestion ?? '' : '' };
  });

  // 3. Share of local search for this business and every business that appears.
  const scored = rows.filter(r => r.intent === 'ok');
  const board = new Map<string, Leader>();
  for (const r of scored) for (const h of r.hits) {
    const b = board.get(h.cid) ?? { cid: h.cid, title: h.title, share: 0, reviews: h.ratingCount, rating: h.rating, top3: 0, appearances: 0, isSelf: false };
    b.share += visibilityPoints(h.position);
    b.appearances++;
    if (h.position <= 3) b.top3++;
    b.isSelf ||= h.isSelf;
    b.reviews = Math.max(b.reviews, h.ratingCount);
    board.set(h.cid, b);
  }
  for (const b of board.values()) b.share = scored.length ? Math.round((b.share / scored.length) * 10) / 10 : 0;
  const ranked = [...board.values()].sort((a, b) => b.share - a.share);
  const selfShare = scored.length ? Math.round((scored.reduce((s, r) => s + visibilityPoints(r.position), 0) / scored.length) * 10) / 10 : 0;
  const leaderboard = ranked.slice(0, 10);
  const me = ranked.find(b => b.isSelf);
  if (me && !leaderboard.includes(me)) leaderboard.push(me);

  // 4. Why the leaders lead: their full profiles (cached a week, shared) against this one.
  const top = (await pool(ranked.filter(b => !b.isSelf).slice(0, 5), 3, b => profile(b.cid))).filter(Boolean) as Profile[];
  const selfCats = [v.primaryCategory?.displayName, ...v.additionalCategories.map(c => c.displayName)].filter(Boolean) as string[];
  const { gaps, missing } = findGaps(l, rows, top, selfCats);

  const summary: RunSummary = {
    visibility: selfShare, scored: scored.length, total: rows.length,
    rank: me ? ranked.indexOf(me) + 1 : null, field: ranked.length,
    leaderboard, gaps, categories: { self: selfCats, missing },
  };

  // 5. Store the run, every rank, and what was learned about each search.
  const r = run('INSERT INTO keyword_runs (location_id, keywords, visibility, summary_json) VALUES (?,?,?,?)', locationId, rows.length, selfShare, JSON.stringify(summary));
  const runId = Number(r.lastInsertRowid);
  for (const row of rows) {
    run('INSERT INTO keyword_ranks (run_id, location_id, keyword_id, phrase, position, total, intent, note, results_json) VALUES (?,?,?,?,?,?,?,?,?)',
      runId, locationId, row.kw.id, row.phrase, row.position, row.hits.length, row.intent, row.note || null, JSON.stringify(row.hits));
    // thin/error describe this run only; they must not erase an earlier ok/wrong judgement.
    if (row.intent === 'ok' || row.intent === 'wrong') {
      run('UPDATE keywords SET intent = ?, intent_note = ?, suggestion = ? WHERE id = ?', row.intent, row.note || null, row.better || null, row.kw.id);
    } else if (!judged(row.kw)) {
      run('UPDATE keywords SET intent = ?, intent_note = ? WHERE id = ?', row.intent, row.note || null, row.kw.id);
    }
  }
  updateConfig(locationId, { next_keywords_at: new Date(Date.now() + 7 * 86_400_000).toISOString() });
  log('keywords', 'ok', `${rows.length} searches, ${scored.length} scored, share ${selfShare}%`, locationId);
  return summary;
}

// ---------------------------------------------------------------- reading

export function latestRun(locationId: string): RunRow | undefined {
  return one<RunRow>('SELECT * FROM keyword_runs WHERE location_id = ? ORDER BY id DESC LIMIT 1', locationId);
}
export function summaryOf(r: RunRow | undefined): RunSummary | null { return r ? parse<RunSummary | null>(r.summary_json, null) : null; }
export function ranksFor(runId: number): (RankRow & { hits: Hit[] })[] {
  return all<RankRow>('SELECT * FROM keyword_ranks WHERE run_id = ? ORDER BY id', runId).map(r => ({ ...r, hits: parse<Hit[]>(r.results_json, []) }));
}
export function history(locationId: string, n = 12): RunRow[] {
  return all<RunRow>('SELECT id, location_id, ran_at, keywords, visibility, NULL AS summary_json FROM keyword_runs WHERE location_id = ? ORDER BY id DESC LIMIT ?', locationId, n).reverse();
}
/**
 * Position for each phrase in the run before `runId`, for the change arrows and the trend delta.
 * Only searches that were actually scored then: a search that failed or returned the wrong kind of
 * business last time has no position to compare with, so it shows as new rather than a huge jump.
 */
export function previousPositions(locationId: string, runId: number): Map<string, number | null> {
  const prev = one<{ id: number }>('SELECT id FROM keyword_runs WHERE location_id = ? AND id < ? ORDER BY id DESC LIMIT 1', locationId, runId);
  const m = new Map<string, number | null>();
  if (prev) for (const r of all<{ phrase: string; position: number | null }>(`SELECT phrase, position FROM keyword_ranks WHERE run_id = ? AND intent = 'ok'`, prev.id)) m.set(r.phrase.toLowerCase(), r.position);
  return m;
}

/** Change in share on the searches scored in both runs, so adding or losing a search does not read as progress. */
export function likeForLike(ranks: { phrase: string; position: number | null; intent: string }[], prev: Map<string, number | null>): { delta: number; searches: number } | null {
  const both = ranks.filter(r => r.intent === 'ok' && prev.has(r.phrase.toLowerCase()));
  if (!both.length) return null;
  const d = both.reduce((sum, r) => sum + visibilityPoints(r.position) - visibilityPoints(prev.get(r.phrase.toLowerCase()) ?? null), 0) / both.length;
  return { delta: Math.round(d * 10) / 10, searches: both.length };
}

/** Weekly re-check for tracked clients. Prospects are created with this switched off. */
export function due(l: LocationRow): boolean {
  if (!l.keywords_weekly || !process.env.SERPER_API_KEY) return false;
  if (!activeKeywords(l.id).length) return false;             // never auto-suggest; only re-check what someone chose to track
  return !l.next_keywords_at || new Date(l.next_keywords_at).getTime() <= Date.now();
}

/** Before a report: make sure there is a run no older than a week, suggesting searches if there are none. */
export async function ensureKeywordRun(locationId: string, maxAgeDays = 7): Promise<RunSummary | null> {
  const l = location(locationId);
  if (!l || !process.env.SERPER_API_KEY || !view(l).town) return summaryOf(latestRun(locationId));
  const last = latestRun(locationId);
  if (last && Date.now() - new Date(last.ran_at + 'Z').getTime() < maxAgeDays * 86_400_000) return summaryOf(last);
  try { return await runKeywords(locationId); }
  catch (e: any) { log('keywords', 'error', e.message, locationId); return summaryOf(last); }
}

/**
 * Categories used by the competitors that outrank this business (the top five of its latest
 * competitor check), that it does not use now. Worked out when asked, against its current
 * categories, so a category added since the check drops off. Names are Google display names as the
 * listings show them; the category picker matches each to Google's own list before adding it.
 */
export function rivalCategories(l: LocationRow): { checkedAt: string; top: number; list: { name: string; count: number; by: string[] }[] } | null {
  const r = latestRun(l.id);
  const s = summaryOf(r);
  if (!r || !s) return null;
  const top = s.leaderboard.filter(b => !b.isSelf).slice(0, 5);
  const v = view(l);
  const own = new Set([v.primaryCategory, ...v.additionalCategories].filter(Boolean).map(c => c!.displayName!.toLowerCase()));
  const found = new Map<string, { name: string; count: number; by: string[] }>();
  for (const b of top) {
    const p = one<{ json: string }>('SELECT json FROM competitor_profiles WHERE cid = ?', b.cid);
    const cats: string[] = p ? (parse<{ categories?: string[] }>(p.json, {}).categories ?? []) : [];
    for (const c of new Set(cats)) {
      const k = c.toLowerCase();
      if (own.has(k) || CATCH_ALL.has(k)) continue;
      const f = found.get(k) ?? { name: c, count: 0, by: [] };
      f.count++;
      f.by.push(b.title);
      found.set(k, f);
    }
  }
  const list = [...found.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 8);
  return { checkedAt: (r as any).ran_at ?? '', top: top.length, list };
}
