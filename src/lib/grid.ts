import { all, one, run, parse, log } from './db';
import { location, view, updateConfig, type LocationRow } from './locations';
import { isSelf } from './benchmark';
import { storedCentre, type Centre } from './geo';
import { withUsage } from './usage';
import { visibilityPoints, type KeywordRow } from './keywords';
import { meter, CREDITS } from './usage';

/**
 * Map grid: rank checked from a grid of points around the business, for each chosen search, as if a
 * customer at that spot searched Google Maps. Distance matters: around J's Electrical a 2-mile
 * "consumer unit replacement" map ranges from 1st to 2nd, and its competitors differ point to point.
 *
 * Measured facts this is built on (Serper /maps with a searcher location, 2026-09-21):
 *  - /maps honours `ll`; /places ignores it, so this uses /maps at 3 credits a call, up to 20 results.
 *  - The zoom sets how much map the search "sees", and Serper's screen is landscape (about 1280 x 800
 *    px, inferred: at 14z J's vanishes between 1 and 2 miles north but between 2 and 3 miles east).
 *    A point far enough out that the business is off-screen reports "not found" because of the
 *    screen's shape, not Google's ranking. A fixed 14z therefore drew a false cliff 2 miles north
 *    and south of every business.
 *  - Zoom also changes the ranking at a spot: a zoom per distance (14z at 1 mile, 13z at 2, 12z at 3)
 *    made Nick Dyer 1st at a spot on the 2-mile map and 6th at the same spot on the 3-mile map. So
 *    there are two fixed zooms (zoomFor): every close-range map (0.5, 1, 2 miles) is searched at 13z,
 *    which still keeps the business in view from 2 miles, and every wider-area map (3, 5 miles) at
 *    11z. A spot gives the same answer at any close-range distance; wider-area maps are a separate,
 *    district-level view, and maps are only compared with maps made at the same zoom.
 *  - Wording can matter as much as location. From its own address J's Electrical is 2nd for
 *    "electrician", "electrician near me" and "electrician in Swindon" alike, but Ridgeline Roofing
 *    is nowhere for "roofer" and 5th for "roofer in Chippenham" or "roofing company": Google links it
 *    with "roofing", not "roofer". By default the town is dropped ("roofer", as typed by someone
 *    nearby); `withTown` keeps it so a map can match the Competitors tab. Maps are only compared
 *    with maps searched the same way.
 *  - The same point searched twice returns the same order.
 */
const SERPER = 'https://google.serper.dev';
/** Every close-range map (up to 2 miles) is searched at this zoom, so a spot reads the same at any of them. */
export const CLOSE_ZOOM = 13;
/** Every wider-area map (3 and 5 miles) is searched at this zoom: far enough out to see the business from 5 miles. */
export const WIDE_ZOOM = 11;
/** Kept for older callers: the closest zoom any map uses. */
export const ZOOM = CLOSE_ZOOM;
/** Serper's search screen height in pixels, inferred from where businesses drop out of view. */
const SCREEN_HALF_HEIGHT_PX = 400;

/**
 * The zoom for a map: 13 for every close-range map (0.5, 1, 2 miles), 11 for every wider-area map
 * (3, 5 miles). Fixed per group, not per distance, so changing the distance within a group never
 * changes how a spot is searched. As a safeguard for far-north businesses, where the same zoom shows
 * less ground, it zooms out further if the farthest point would lose sight of the business.
 */
export function zoomFor(radiusMi: number, lat: number): number {
  const halfHeightMi = (z: number) => (SCREEN_HALF_HEIGHT_PX * 156543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** z / 1609.34;
  let z = isWideArea(radiusMi) ? WIDE_ZOOM : CLOSE_ZOOM;
  while (z > 9 && halfHeightMi(z) < radiusMi * 1.25) z--;
  return z;
}
export const isWideArea = (radiusMi: number) => radiusMi > 2;
export const CREDITS_PER_POINT = 3;
export const SIZES = [3, 5, 7] as const;
export const CLOSE_RADII = [0.5, 1, 2] as const;
export const WIDE_RADII = [3, 5] as const;
export const RADII = [...CLOSE_RADII, ...WIDE_RADII] as const;
const CACHE_HOURS = 24;

export type GridRun = {
  id: number; location_id: string; ran_at: string; status: 'running' | 'done' | 'error';
  size: number; radius_mi: number; zoom: number; center_lat: number; center_lng: number;
  total: number; done: number; credits: number; visibility: number | null; summary_json: string | null; error: string | null;
  /** 1 when the searches kept the town, 0 when it was dropped; null on maps made before this was stored. */
  with_town: number | null;
};

/**
 * A map with more than this share of its points unread is not a result. Each point is already
 * retried three times, so a point that still failed means the search service was not answering.
 * When it ran out of credits every point failed, the run was stored as "done" with a share of 0%,
 * and the page and the client report said "Not in the first 20 anywhere on the map". Nobody had
 * looked. A few failed points are left out of the figures, which is what `summarise` already does.
 */
export const MAX_FAILED_SHARE = 0.2;
/** A scheduled map that could not be read is tried again after this long, not on the next tick. */
const RETRY_FAILED_MAP_HOURS = 24;
export type GridPoint = {
  id: number; run_id: number; keyword_id: number | null; phrase: string; query: string;
  row: number; col: number; lat: number; lng: number; position: number | null; total: number; top_json: string | null; error: string | null;
};
export type Top = { cid: string; title: string; rating: number | null; ratingCount: number };
export type KeywordGrid = {
  phrase: string; query: string;
  points: number; found: number; top3: number; first: number;
  /** Average position, counting "not in the first 20" as 21, the usual convention for grid reports. */
  avgRank: number;
  visibility: number;
  /** Who is #1 most often across the map. */
  leaders: { cid: string; title: string; firsts: number; top3: number; isSelf: boolean }[];
  /** Average points by side of the business, to say which direction customers stop finding it. */
  sides: { north: number; south: number; east: number; west: number };
};
export type GridSummary = { visibility: number; keywords: KeywordGrid[] };

// ---------------------------------------------------------------- geometry

/** Evenly spaced points from -radius to +radius in both directions; row 0 is the north edge, col 0 the west. */
export function gridPoints(lat: number, lng: number, size: number, radiusMi: number) {
  const step = size > 1 ? (2 * radiusMi) / (size - 1) : 0;
  const perMiLat = 1 / 69.0;
  const perMiLng = 1 / (69.172 * Math.cos((lat * Math.PI) / 180));
  const out: { row: number; col: number; lat: number; lng: number }[] = [];
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    out.push({ row, col, lat: lat + (radiusMi - row * step) * perMiLat, lng: lng + (-radiusMi + col * step) * perMiLng });
  }
  return out;
}

/** "electrician in Swindon" → "electrician": what someone types on their phone, standing somewhere. */
export function phoneQuery(phrase: string, town: string): string {
  if (!town) return phrase.trim();
  const t = town.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
  // "in Bath" is the town. Where the town is also a word ("bath resurfacing in Bath"), taking the
  // first match removed the product and searched "resurfacing in Bath".
  const withWord = new RegExp(`\\s*\\b(in|near|around)\\s+${t}\\b\\s*`, 'i');
  if (withWord.test(phrase)) return tidy(phrase.replace(withWord, ' ')) || phrase.trim();
  // No "in": the town is the LAST time the word appears ("bath resurfacing Bath").
  const bare = new RegExp(`\\b${t}\\b`, 'gi');
  let last = -1, len = 0;
  for (let m = bare.exec(phrase); m; m = bare.exec(phrase)) { last = m.index; len = m[0].length; }
  if (last < 0) return phrase.trim();
  return tidy(phrase.slice(0, last) + ' ' + phrase.slice(last + len)) || phrase.trim();
}

// ---------------------------------------------------------------- search at a point

/** Serper calls actually made by one run (cache hits cost nothing); per run, so concurrent runs don't mix. */
type Counter = { calls: number };

async function mapsAt(q: string, lat: number, lng: number, zoom: number, counter: Counter): Promise<any[]> {
  const key = `maps|${q.toLowerCase()}|${lat.toFixed(4)}|${lng.toFixed(4)}|${zoom}`;
  const hit = one<{ json: string; fetched_at: string }>('SELECT json, fetched_at FROM serp_cache WHERE key = ?', key);
  if (hit && Date.now() - new Date(hit.fetched_at + 'Z').getTime() < CACHE_HOURS * 3_600_000) return parse<any[]>(hit.json, []);
  const apiKey = process.env.SERPER_API_KEY?.trim();
  if (!apiKey) throw new Error('SERPER_API_KEY is not set');

  let last: Error | null = null;
  for (const wait of [0, 2000, 5000]) {
    if (wait) await new Promise(r => setTimeout(r, wait));
    try {
      counter.calls++;
      meter('serper', { credits: CREDITS.maps, kind: 'map grid' });
      const res = await fetch(`${SERPER}/maps`, {
        method: 'POST', headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, ll: `@${lat.toFixed(6)},${lng.toFixed(6)},${zoom}z`, gl: 'gb', hl: 'en' }),
      });
      if (!res.ok) throw new Error(`Serper maps ${res.status}`);
      const j: any = await res.json();
      // Serper reports its own failures as a 200 with a message and no places.
      if (!Array.isArray(j.places) && j.message) throw new Error(`Google could not be read here (${j.message})`);
      const places = (j.places ?? []).map((p: any, i: number) => ({ ...p, position: i + 1 }));
      // Serper also returns an empty list with no message now and then: two points in central
      // Swindon came back empty for "consumer unit replacement" and ranked J's 1st and 2nd on a
      // retry. Treat empty as a failed read, never as "not found", or the map punishes the business
      // for an API hiccup.
      if (!places.length) throw new Error('No results came back for this point');
      run(`INSERT INTO serp_cache (key, json, fetched_at) VALUES (?,?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at`, key, JSON.stringify(places));
      return places;
    } catch (e: any) { last = e; }
  }
  throw last ?? new Error('Google could not be read here');
}

// ---------------------------------------------------------------- summary

function summarise(r: GridRun, pts: GridPoint[]): GridSummary {
  const byKw = new Map<string, GridPoint[]>();
  for (const p of [...pts].sort((a, b) => (a.keyword_id ?? 1e9) - (b.keyword_id ?? 1e9))) byKw.set(p.phrase, [...(byKw.get(p.phrase) ?? []), p]);
  const mid = (r.size - 1) / 2;
  const keywords: KeywordGrid[] = [...byKw].map(([phrase, ps]) => {
    const ok = ps.filter(p => !p.error);
    const avg = (xs: GridPoint[]) => (xs.length ? Math.round((xs.reduce((s, p) => s + visibilityPoints(p.position), 0) / xs.length) * 10) / 10 : 0);
    const leaders = new Map<string, { cid: string; title: string; firsts: number; top3: number; isSelf: boolean }>();
    for (const p of ok) for (const [i, t] of parse<(Top & { isSelf?: boolean })[]>(p.top_json, []).entries()) {
      const b = leaders.get(t.cid) ?? { cid: t.cid, title: t.title, firsts: 0, top3: 0, isSelf: Boolean(t.isSelf) };
      if (i === 0) b.firsts++;
      b.top3++;
      leaders.set(t.cid, b);
    }
    return {
      phrase, query: ps[0]?.query ?? phrase,
      points: ok.length,
      found: ok.filter(p => p.position).length,
      top3: ok.filter(p => p.position && p.position <= 3).length,
      first: ok.filter(p => p.position === 1).length,
      avgRank: ok.length ? Math.round((ok.reduce((s, p) => s + (p.position ?? 21), 0) / ok.length) * 10) / 10 : 21,
      visibility: avg(ok),
      leaders: [...leaders.values()].sort((a, b) => b.firsts - a.firsts || b.top3 - a.top3).slice(0, 5),
      sides: {
        north: avg(ok.filter(p => p.row < mid)), south: avg(ok.filter(p => p.row > mid)),
        west: avg(ok.filter(p => p.col < mid)), east: avg(ok.filter(p => p.col > mid)),
      },
    };
  });
  const visibility = keywords.length ? Math.round((keywords.reduce((s, k) => s + k.visibility, 0) / keywords.length) * 10) / 10 : 0;
  return { visibility, keywords };
}

// ---------------------------------------------------------------- run (in the background)

declare global {
  // eslint-disable-next-line no-var
  var __gbpGridRuns: Set<number> | undefined;
}
const running = globalThis.__gbpGridRuns ?? (globalThis.__gbpGridRuns = new Set<number>());

/** Where the map is centred: the Google pin when there is one, else the position worked out from the address. */
export function centre(l: LocationRow): Centre | null {
  return storedCentre(l);
}

export function estimate(size: number, keywords: number) {
  const calls = size * size * keywords;
  return { points: size * size, calls, credits: calls * CREDITS_PER_POINT };
}

/** Start a grid run and return at once; the page polls while `status` is running. */
export function startGrid(locationId: string, opts: { size: number; radiusMi: number; keywordIds: number[]; withTown?: boolean }): { runId: number } {
  const l = location(locationId);
  if (!l) throw new Error('Unknown location');
  if (!process.env.SERPER_API_KEY) throw new Error('SERPER_API_KEY is not set, so the map cannot be checked.');
  const c = centre(l);
  if (!c) throw new Error('This business has no position yet: Google gives no map pin, and the address could not be placed. Add a fuller address on the Settings tab, then try again.');
  const size = SIZES.includes(opts.size as any) ? opts.size : 5;
  const radiusMi = RADII.includes(opts.radiusMi as any) ? opts.radiusMi : 2;
  const kws = opts.keywordIds.map(id => one<KeywordRow>('SELECT * FROM keywords WHERE id = ? AND location_id = ?', id, locationId)).filter(Boolean) as KeywordRow[];
  if (!kws.length) throw new Error('Choose at least one search to map.');
  if (all('SELECT id FROM grid_runs WHERE location_id = ? AND status = ?', locationId, 'running').some((r: any) => running.has(r.id))) {
    throw new Error('A map for this business is already being checked.');
  }

  const town = view(l).town;
  const points = gridPoints(c.lat, c.lng, size, radiusMi);
  const zoom = zoomFor(radiusMi, c.lat);
  const r = run(`INSERT INTO grid_runs (location_id, status, size, radius_mi, zoom, center_lat, center_lng, total, with_town) VALUES (?,?,?,?,?,?,?,?,?)`,
    locationId, 'running', size, radiusMi, zoom, c.lat, c.lng, points.length * kws.length, opts.withTown ? 1 : 0);
  const runId = Number(r.lastInsertRowid);
  running.add(runId);

  // The run carries on in the background; withUsage keeps its spend against this business.
  withUsage(locationId, 'map grid', () => (async () => {
    const counter: Counter = { calls: 0 };
    const jobs = kws.flatMap(k => points.map(p => ({ k, p, query: opts.withTown ? k.phrase : phoneQuery(k.phrase, town) })));
    let i = 0, done = 0;
    const worker = async () => {
      while (i < jobs.length) {
        const { k, p, query } = jobs[i++];
        let position: number | null = null, total = 0, top: (Top & { isSelf: boolean })[] = [], error: string | null = null;
        try {
          const places = await mapsAt(query, p.lat, p.lng, zoom, counter);
          total = places.length;
          let seen = false;
          const marked = places.map((x: any) => { const me = !seen && isSelf(x, l); if (me) seen = true; return { ...x, me }; });
          position = marked.find((x: any) => x.me)?.position ?? null;
          top = marked.slice(0, 3).map((x: any) => ({ cid: String(x.cid), title: String(x.title ?? ''), rating: x.rating ?? null, ratingCount: Number(x.ratingCount ?? 0), isSelf: x.me }));
        } catch (e: any) { error = e.message; }
        run(`INSERT INTO grid_points (run_id, keyword_id, phrase, query, row, col, lat, lng, position, total, top_json, error) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          runId, k.id, k.phrase, query, p.row, p.col, p.lat, p.lng, position, total, JSON.stringify(top), error);
        done++;
        run('UPDATE grid_runs SET done = ? WHERE id = ?', done, runId);
      }
    };
    try {
      await Promise.all(Array.from({ length: 4 }, worker));
      const gr = one<GridRun>('SELECT * FROM grid_runs WHERE id = ?', runId)!;
      const s = summarise(gr, points_(runId));
      const failed = points_(runId).filter(p => p.error).length;
      if (jobs.length && failed / jobs.length > MAX_FAILED_SHARE) {
        const why = points_(runId).find(p => p.error)?.error ?? 'no answer';
        run(`UPDATE grid_runs SET status = 'error', credits = ?, error = ? WHERE id = ?`, counter.calls * CREDITS_PER_POINT,
          `${failed} of ${jobs.length} points could not be read (${why}), so this map was not kept. It says nothing about the business: the searches did not run. Check the map again later.`, runId);
        // The earlier map stays the latest result. A monthly re-map is tried again tomorrow.
        if (location(locationId)?.next_grid_at) updateConfig(locationId, { next_grid_at: new Date(Date.now() + RETRY_FAILED_MAP_HOURS * 3_600_000).toISOString() });
        log('grid', 'error', `${failed} of ${jobs.length} points could not be read: ${why}`, locationId);
        return;
      }
      run(`UPDATE grid_runs SET status = 'done', credits = ?, visibility = ?, summary_json = ?, error = ? WHERE id = ?`,
        counter.calls * CREDITS_PER_POINT, s.visibility, JSON.stringify(s), failed ? `${failed} point${failed === 1 ? '' : 's'} could not be read` : null, runId);
      updateConfig(locationId, { next_grid_at: new Date(Date.now() + 30 * 86_400_000).toISOString() });
      log('grid', 'ok', `${size}x${size}, ${radiusMi} mi, zoom ${zoom}, ${kws.length} search(es): visibility ${s.visibility}%, ${counter.calls} calls`, locationId);
    } catch (e: any) {
      run(`UPDATE grid_runs SET status = 'error', error = ? WHERE id = ?`, e.message, runId);
      log('grid', 'error', e.message, locationId);
    } finally {
      running.delete(runId);
    }
  })());
  return { runId };
}

// ---------------------------------------------------------------- reading

const points_ = (runId: number) => all<GridPoint>('SELECT * FROM grid_points WHERE run_id = ? ORDER BY phrase, row, col', runId);
export const gridPointsFor = points_;

/** A run left "running" by a server restart would spin forever; call it interrupted instead. */
function settle(r: GridRun | undefined): GridRun | undefined {
  if (r && r.status === 'running' && !running.has(r.id)) {
    run(`UPDATE grid_runs SET status = 'error', error = 'Interrupted (the app was restarted). Run it again.' WHERE id = ?`, r.id);
    return one<GridRun>('SELECT * FROM grid_runs WHERE id = ?', r.id);
  }
  return r;
}
export function latestGrid(locationId: string): GridRun | undefined {
  return settle(one<GridRun>('SELECT * FROM grid_runs WHERE location_id = ? ORDER BY id DESC LIMIT 1', locationId));
}
export function latestDoneGrid(locationId: string): GridRun | undefined {
  return one<GridRun>(`SELECT * FROM grid_runs WHERE location_id = ? AND status = 'done' ORDER BY id DESC LIMIT 1`, locationId);
}
export function previousDoneGrid(locationId: string, beforeId: number): GridRun | undefined {
  return one<GridRun>(`SELECT * FROM grid_runs WHERE location_id = ? AND status = 'done' AND id < ? ORDER BY id DESC LIMIT 1`, locationId, beforeId);
}
export function gridSummary(r: GridRun | undefined): GridSummary | null { return r ? parse<GridSummary | null>(r.summary_json, null) : null; }
export const isRunning = (runId: number) => running.has(runId);

/** Monthly re-map for businesses switched on, with the settings and searches of the last run. */
export function gridDue(l: LocationRow): boolean {
  if (!l.grid_monthly || !process.env.SERPER_API_KEY) return false;
  const last = latestDoneGrid(l.id);
  if (!last) return false;
  return !l.next_grid_at || new Date(l.next_grid_at).getTime() <= Date.now();
}
export function rerunLast(locationId: string) {
  const last = latestDoneGrid(locationId);
  if (!last) throw new Error('No earlier map to repeat');
  const ids = [...new Set(points_(last.id).map(p => p.keyword_id).filter((x): x is number => x != null))];
  // The wording is what the last map recorded. It used to be guessed from the first point, and a
  // first search with no town in it ("boiler repair") reads the same either way, so the re-map
  // kept the town on every other search and the two maps could not be compared.
  const pts = points_(last.id);
  const guess = pts.some(p => p.query !== p.phrase) ? false : Boolean(pts[0]);
  return startGrid(locationId, { size: last.size, radiusMi: last.radius_mi, keywordIds: ids, withTown: last.with_town == null ? guess : Boolean(last.with_town) });
}

// ---------------------------------------------------------------- map layout (shared by the app and the report)

const TILE = 256;
function project(lat: number, lng: number, z: number) {
  const scale = TILE * 2 ** z;
  const sin = Math.sin((lat * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale };
}

/**
 * Position OpenStreetMap tiles and the grid points in percentages of a box, so the same layout
 * renders in the app and in the static report without a map library.
 */
export function mapLayout(pts: { lat: number; lng: number }[], centreLL: { lat: number; lng: number }, target = 520, pad = 44) {
  let z = 17;
  const span = (zz: number) => {
    const ps = pts.map(p => project(p.lat, p.lng, zz));
    return { ps, minX: Math.min(...ps.map(p => p.x)), maxX: Math.max(...ps.map(p => p.x)), minY: Math.min(...ps.map(p => p.y)), maxY: Math.max(...ps.map(p => p.y)) };
  };
  let s = span(z);
  while (z > 8 && Math.max(s.maxX - s.minX, s.maxY - s.minY) > target) { z--; s = span(z); }
  const minX = s.minX - pad, maxX = s.maxX + pad, minY = s.minY - pad, maxY = s.maxY + pad;
  const W = maxX - minX, H = maxY - minY;
  const tiles: { url: string; left: number; top: number; w: number; h: number }[] = [];
  for (let tx = Math.floor(minX / TILE); tx <= Math.floor(maxX / TILE); tx++) {
    for (let ty = Math.floor(minY / TILE); ty <= Math.floor(maxY / TILE); ty++) {
      tiles.push({ url: `https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`, left: ((tx * TILE - minX) / W) * 100, top: ((ty * TILE - minY) / H) * 100, w: (TILE / W) * 100, h: (TILE / H) * 100 });
    }
  }
  const at = (lat: number, lng: number) => { const p = project(lat, lng, z); return { left: ((p.x - minX) / W) * 100, top: ((p.y - minY) / H) * 100 }; };
  return { z, ratio: W / H, tiles, pins: pts.map(p => at(p.lat, p.lng)), centre: at(centreLL.lat, centreLL.lng) };
}

/**
 * "Not in the first 20 anywhere north of the business, out to 2 miles." Only calls a direction
 * stronger when the difference is real: under 15 points of spread it is noise, not a pattern.
 */
export function sidesLine(k: KeywordGrid, radius: number): string {
  const s = Object.entries(k.sides) as [string, number][];
  const dead = s.filter(([, v]) => v === 0).map(([d]) => d);
  const best = [...s].sort((a, b) => b[1] - a[1])[0];
  const worst = [...s].sort((a, b) => a[1] - b[1])[0];
  const spread = best[1] - worst[1];
  const miles = `${radius} mile${radius === 1 ? '' : 's'}`;
  if (k.found === 0) return `Not in the first 20 anywhere on the map for "${k.query}", not even at the business's own address.`;
  if (dead.length === 4) return 'Only found close to the business itself.';
  const parts: string[] = [];
  if (spread < 15) parts.push(k.found === k.points ? `Found everywhere on the map, about equally well in every direction out to ${miles}.` : 'About the same in every direction.');
  else parts.push(`Stronger to the ${best[0]} than to the ${worst[0]}.`);
  if (dead.length) parts.push(`Not in the first 20 anywhere ${dead.join(' or ')} of the business, out to ${miles}.`);
  return parts.join(' ');
}

export const rankColour = (pos: number | null) => (!pos ? '#6b7280' : pos <= 3 ? '#16a34a' : pos <= 10 ? '#d97706' : '#dc2626');
