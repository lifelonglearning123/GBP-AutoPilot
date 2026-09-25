import { all, one, run, log } from './db';
import { saveManual, location } from './locations';
import { audit } from './audit';
import * as citations from './citations';
import { enrich } from './public';
import { ensureBenchmark } from './benchmark';
import { meter, CREDITS } from './usage';

/**
 * Bulk prospecting. A batch is a list of businesses from a CSV paste or a Serper Places search.
 * Running it creates a manual location per business and runs the citation audit, up to the
 * batch budget. Results rank by mismatches so the worst profiles (best prospects) float up.
 *
 * Cost: each audit is ~15 Serper searches and ~30–40 LLM calls, roughly a minute. The budget is
 * the cap on how many audits a batch may run; raise it deliberately.
 */
export type Batch = { id: number; name: string; source: string; budget: number; status: string; created_at: string; query: string | null };
export type Prospect = {
  id: number; batch_id: number; title: string; street: string | null; town: string | null; postcode: string | null; phone: string | null;
  website: string | null; category: string | null; rating: number | null; rating_count: number | null;
  status: 'queued' | 'running' | 'done' | 'error' | 'skipped'; location_id: string | null; score: number | null; found: number | null; mismatches: number | null;
  cid: string | null;
  error: string | null; created_at: string;
};

export function batches(): (Batch & { total: number; done: number })[] {
  return all(`SELECT b.*, (SELECT COUNT(*) FROM prospects p WHERE p.batch_id = b.id) AS total,
                     (SELECT COUNT(*) FROM prospects p WHERE p.batch_id = b.id AND p.status = 'done') AS done
              FROM prospect_batches b ORDER BY b.id DESC`);
}
export function batch(id: number): Batch | undefined { return one<Batch>('SELECT * FROM prospect_batches WHERE id = ?', id); }
export function prospects(batchId: number): Prospect[] {
  return all<Prospect>(`SELECT * FROM prospects WHERE batch_id = ? ORDER BY CASE status WHEN 'done' THEN 0 WHEN 'running' THEN 1 WHEN 'queued' THEN 2 ELSE 3 END, mismatches DESC, score ASC, id`, batchId);
}

// ---------- intake ----------

/** Header-based CSV: name, street, town, postcode, phone, website, category (any order, any case). */
export function importCsv(name: string, csv: string, budget = 10): Batch {
  const lines = csv.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('Paste a CSV with a header row and at least one business');
  const split = (l: string) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map(x => x.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim()).slice(0, -1);
  const head = split(lines[0]).map(h => h.toLowerCase().replace(/[^a-z]/g, ''));
  const idx = (names: string[]) => head.findIndex(h => names.includes(h));
  const col = { title: idx(['name', 'business', 'businessname', 'company', 'title']), street: idx(['street', 'address', 'address1']), town: idx(['town', 'city', 'locality']),
    postcode: idx(['postcode', 'postalcode', 'zip']), phone: idx(['phone', 'telephone', 'tel']), website: idx(['website', 'url', 'web']), category: idx(['category', 'type']) };
  if (col.title < 0) throw new Error('CSV needs a "name" column');
  const r = run('INSERT INTO prospect_batches (name, source, budget) VALUES (?,?,?)', name || `CSV ${new Date().toISOString().slice(0, 16)}`, 'csv', budget);
  const batchId = Number(r.lastInsertRowid);
  for (const line of lines.slice(1)) {
    const f = split(line);
    const g = (i: number) => (i >= 0 ? f[i] ?? '' : '') || null;
    if (!g(col.title)) continue;
    run('INSERT INTO prospects (batch_id, title, street, town, postcode, phone, website, category) VALUES (?,?,?,?,?,?,?,?)',
      batchId, g(col.title), g(col.street), g(col.town), g(col.postcode), g(col.phone), g(col.website), g(col.category));
  }
  return batch(batchId)!;
}

/** Serper Places: "electricians in St Albans" → up to ~20 businesses with NAP, rating and website. */
export async function searchPlaces(name: string, query: string, budget = 10): Promise<Batch> {
  const key = process.env.SERPER_API_KEY?.trim();
  if (!key) throw new Error('SERPER_API_KEY is not set');
  meter('serper', { credits: CREDITS.places, kind: 'prospecting', locationId: null });
  const res = await fetch('https://google.serper.dev/places', {
    method: 'POST', headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ q: query, gl: 'gb', hl: 'en' }),
  });
  if (!res.ok) throw new Error(`Serper ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j: any = await res.json();
  const places: any[] = j.places ?? [];
  if (!places.length) throw new Error('No places returned for that search');
  const r = run('INSERT INTO prospect_batches (name, source, budget, query) VALUES (?,?,?,?)', name || query, 'search', budget, query);
  const batchId = Number(r.lastInsertRowid);
  for (const p of places) {
    const addr = String(p.address ?? '');
    const pc = /[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i.exec(addr)?.[0]?.toUpperCase() ?? null;
    const parts = addr.replace(pc ?? '', '').split(',').map((x: string) => x.trim()).filter(Boolean);
    const town = parts.length > 1 ? parts[parts.length - 1].replace(/United Kingdom|UK/i, '').trim() || parts[parts.length - 2] : parts[0] ?? null;
    const street = parts.length > 1 ? parts.slice(0, -1).join(', ') : null;
    run('INSERT INTO prospects (batch_id, title, street, town, postcode, phone, website, category, rating, rating_count, cid) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      batchId, p.title, street, town, pc, p.phoneNumber ?? null, p.website ?? null, p.category ?? p.type ?? null, p.rating ?? null, p.ratingCount ?? null, p.cid ? String(p.cid) : null);
  }
  return batch(batchId)!;
}

export function setBudget(batchId: number, budget: number) { run('UPDATE prospect_batches SET budget = ? WHERE id = ?', budget, batchId); }
export function skip(prospectId: number) { run(`UPDATE prospects SET status = 'skipped' WHERE id = ? AND status = 'queued'`, prospectId); }
export function unskip(prospectId: number) { run(`UPDATE prospects SET status = 'queued' WHERE id = ? AND status = 'skipped'`, prospectId); }
export function deleteBatch(batchId: number) { run('DELETE FROM prospect_batches WHERE id = ?', batchId); }
/** Put errored rows back in the queue (after fixing whatever broke). */
export function retryErrors(batchId: number) { run(`UPDATE prospects SET status = 'queued', error = NULL WHERE batch_id = ? AND status = 'error'`, batchId); }

// ---------- runner ----------

declare global {
  // eslint-disable-next-line no-var
  var __gbpProspectRunner: Set<number> | undefined;
}
const running = globalThis.__gbpProspectRunner ?? (globalThis.__gbpProspectRunner = new Set<number>());

/** Kick off the batch in the background; the page polls by refreshing. Returns immediately. */
export function start(batchId: number): { started: boolean; reason?: string } {
  if (running.has(batchId)) return { started: false, reason: 'already running' };
  const b = batch(batchId);
  if (!b) throw new Error('Unknown batch');
  running.add(batchId);
  run(`UPDATE prospect_batches SET status = 'running' WHERE id = ?`, batchId);
  (async () => {
    try {
      while (true) {
        const done = one<{ n: number }>(`SELECT COUNT(*) AS n FROM prospects WHERE batch_id = ? AND status IN ('done','error')`, batchId)!.n;
        const budget = batch(batchId)!.budget;
        if (done >= budget) break;
        const next = one<Prospect>(`SELECT * FROM prospects WHERE batch_id = ? AND status = 'queued' ORDER BY id LIMIT 1`, batchId);
        if (!next) break;
        await auditOne(next);
      }
    } finally {
      running.delete(batchId);
      run(`UPDATE prospect_batches SET status = 'done' WHERE id = ?`, batchId);
    }
  })().catch(e => log('prospects', 'error', e.message));
  return { started: true };
}

export function isRunning(batchId: number) { return running.has(batchId); }

async function auditOne(p: Prospect) {
  run(`UPDATE prospects SET status = 'running' WHERE id = ?`, p.id);
  try {
    const isNew = !(p.location_id && location(p.location_id));
    const l = !isNew ? location(p.location_id!)! : saveManual({
      title: p.title, street: p.street ?? '', town: p.town ?? '', postcode: p.postcode ?? '', phone: p.phone ?? '', website: p.website ?? '', category: p.category ?? '',
    });
    // Prospects are checked on demand, not weekly: switch the scheduled search check off.
    if (isNew) run('UPDATE locations SET keywords_weekly = 0 WHERE id = ?', l.id);
    // A Maps search already told us exactly which listing this is; no need to guess by name.
    if (p.cid && !l.public_cid) {
      try { await enrich(l.id, { cid: p.cid, matchedBy: 'prospect' }); } catch (e: any) { log('prospects', 'error', `${p.title} listing: ${e.message}`, l.id); }
    }
    // Rank it inside the very search it was prospected from; CSV batches get a proposed search instead.
    // Businesses from one search share a cached result, so the whole batch costs one or two credits.
    await ensureBenchmark(l.id, 7, batch(p.batch_id)?.query ?? undefined);
    const r = await citations.audit(l.id);
    const { score } = audit(location(l.id)!);
    run(`UPDATE prospects SET status = 'done', location_id = ?, score = ?, found = ?, mismatches = ?, error = NULL WHERE id = ?`, l.id, score, r.found, r.mismatches, p.id);
    log('prospects', 'ok', `${p.title}: ${score}/100, ${r.mismatches} mismatches`, l.id);
  } catch (e: any) {
    run(`UPDATE prospects SET status = 'error', error = ? WHERE id = ?`, e.message, p.id);
    log('prospects', 'error', `${p.title}: ${e.message}`);
  }
}
