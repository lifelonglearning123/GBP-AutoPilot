import { all, one, run, log } from './db';
import { json as llmJson } from './llm';
import { location, view, updateConfig, type LocationRow } from './locations';
import { createQuestionWithAnswer, createPhoto, fetchDailyMetrics, DAILY_METRICS, type DailyMetric } from './gbp';

// ======================= Q&A seeding =======================

export type QnaRow = { id: number; location_id: string; question: string; answer: string; status: 'draft' | 'posted' | 'failed' | 'rejected'; google_name: string | null; error: string | null; posted_at: string | null; created_at: string };

export function qna(locationId: string): QnaRow[] {
  return all<QnaRow>('SELECT * FROM qna WHERE location_id = ? ORDER BY id DESC', locationId);
}

/**
 * The Q&A section is public and indexed, and left alone it fills with strangers' questions or
 * stays empty. Seeding it with the questions customers actually ask, answered by the owner, is
 * cheap and durable. Pulls FAQs from generated site pages first so answers stay consistent.
 */
export async function generateQna(locationId: string, count = 6): Promise<QnaRow[]> {
  const l = location(locationId);
  if (!l) throw new Error('Unknown location');
  const v = view(l);
  const siteFaqs = all<{ content_json: string }>('SELECT content_json FROM site_pages WHERE location_id = ?', locationId)
    .flatMap(p => { try { return (JSON.parse(p.content_json).faqs ?? []) as { q: string; a: string }[]; } catch { return []; } }).slice(0, 20);
  const existing = qna(locationId).filter(q => q.status !== 'rejected').map(q => q.question);
  const system = `You write owner-seeded Google Business Profile Q&A entries for ${v.title}, a ${v.primaryCategory?.displayName ?? 'local business'} in ${v.town || 'the local area'}.
Voice: ${v.brand_voice || 'plain, warm, professional British English; the owner speaking.'}
Rules: questions phrased the way a customer would type them (pricing, areas covered, availability, guarantees, process, parking, payment). Answers 1 to 3 sentences, specific, mention the town or a service naturally once. No URLs, no phone numbers, no emojis. Do not repeat existing questions.
Return JSON: { "items": [{ "question": string, "answer": string }] } with exactly ${count} items.`;
  const user = [
    `Services: ${[...new Set([...v.offeredServices, ...v.serviceNames])].join(', ') || 'general'}`,
    `Areas: ${v.serviceAreas.join(', ') || v.town}`,
    `Opening days: ${v.hoursPeriods.map((p: any) => p.openDay).join(', ') || 'unknown'}`,
    `Existing questions (avoid): ${existing.join(' | ') || 'none'}`,
    `FAQs already written for the website (reuse where sensible):\n${siteFaqs.map(f => `Q: ${f.q}\nA: ${f.a}`).join('\n') || '(none)'}`,
  ].join('\n\n');
  const out = await llmJson<{ items: { question: string; answer: string }[] }>(system, user);
  for (const it of (out.items ?? []).slice(0, count)) {
    if (it.question && it.answer) run('INSERT INTO qna (location_id, question, answer) VALUES (?,?,?)', locationId, String(it.question).trim(), String(it.answer).trim());
  }
  return qna(locationId);
}

export function editQna(id: number, question: string, answer: string) { run(`UPDATE qna SET question = ?, answer = ? WHERE id = ? AND status = 'draft'`, question, answer, id); }
export function rejectQna(id: number) { run(`UPDATE qna SET status = 'rejected' WHERE id = ?`, id); }

export async function postQna(id: number): Promise<void> {
  const q = one<QnaRow>('SELECT * FROM qna WHERE id = ?', id);
  if (!q) throw new Error('Unknown Q&A');
  try {
    const g = await createQuestionWithAnswer(q.location_id, q.question, q.answer);
    run(`UPDATE qna SET status = 'posted', google_name = ?, posted_at = datetime('now'), error = NULL WHERE id = ?`, g.name, id);
    log('qna', 'ok', q.question.slice(0, 80), q.location_id);
  } catch (e: any) {
    run(`UPDATE qna SET status = 'failed', error = ? WHERE id = ?`, e.message, id);
    log('qna', 'error', e.message, q.location_id);
    throw e;
  }
}

// ======================= Photo queue =======================

export type PhotoRow = { id: number; location_id: string; url: string; category: string; caption: string | null; status: 'queued' | 'posted' | 'failed'; error: string | null; posted_at: string | null; created_at: string };

export function photos(locationId: string): PhotoRow[] {
  return all<PhotoRow>('SELECT * FROM photo_queue WHERE location_id = ? ORDER BY CASE status WHEN \'queued\' THEN 0 ELSE 1 END, id', locationId);
}

/** Add several at once: one URL per line, optional " | caption" after it. */
export function enqueuePhotos(locationId: string, lines: string, category = 'ADDITIONAL'): number {
  let n = 0;
  for (const raw of lines.split(/\r?\n/)) {
    const [url, ...cap] = raw.split('|').map(x => x.trim());
    if (!/^https?:\/\//i.test(url ?? '')) continue;
    run('INSERT INTO photo_queue (location_id, url, category, caption) VALUES (?,?,?,?)', locationId, url, category, cap.join(' | ') || null);
    n++;
  }
  const l = location(locationId)!;
  if (n && !l.next_photo_at) updateConfig(locationId, { next_photo_at: new Date().toISOString() });
  return n;
}
export function removePhoto(id: number) { run(`DELETE FROM photo_queue WHERE id = ? AND status = 'queued'`, id); }

export async function postPhoto(id: number): Promise<void> {
  const p = one<PhotoRow>('SELECT * FROM photo_queue WHERE id = ?', id);
  if (!p) throw new Error('Unknown photo');
  const l = location(p.location_id)!;
  try {
    await createPhoto(l.account, l.id, p.url, p.category, p.caption ?? undefined);
    run(`UPDATE photo_queue SET status = 'posted', posted_at = datetime('now'), error = NULL WHERE id = ?`, id);
    log('photo', 'ok', p.url, l.id);
  } catch (e: any) {
    run(`UPDATE photo_queue SET status = 'failed', error = ? WHERE id = ?`, e.message, id);
    log('photo', 'error', e.message, l.id);
    throw e;
  }
}

/** Scheduler hook: release the next queued photo when due, then move the date on. */
export async function runPhotoSchedule(l: LocationRow): Promise<string | null> {
  if (!l.next_photo_at || new Date(l.next_photo_at).getTime() > Date.now()) return null;
  const next = one<PhotoRow>(`SELECT * FROM photo_queue WHERE location_id = ? AND status = 'queued' ORDER BY id LIMIT 1`, l.id);
  if (!next) { updateConfig(l.id, { next_photo_at: null }); return 'photo queue empty'; }
  await postPhoto(next.id);
  const d = new Date(); d.setDate(d.getDate() + (l.photo_every_days || 14));
  updateConfig(l.id, { next_photo_at: d.toISOString() });
  return `photo #${next.id} posted`;
}

// ======================= Performance metrics =======================

export const METRIC_GROUPS: { key: string; label: string; metrics: DailyMetric[] }[] = [
  { key: 'views', label: 'Profile views', metrics: ['BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH'] },
  { key: 'calls', label: 'Calls', metrics: ['CALL_CLICKS'] },
  { key: 'website', label: 'Website clicks', metrics: ['WEBSITE_CLICKS'] },
  { key: 'directions', label: 'Directions', metrics: ['BUSINESS_DIRECTION_REQUESTS'] },
  { key: 'messages', label: 'Messages + bookings', metrics: ['BUSINESS_CONVERSATIONS', 'BUSINESS_BOOKINGS'] },
];

/** Pull the last 60 days (Google lags ~2 days), upserting so re-runs are cheap. */
export async function syncMetrics(locationId: string): Promise<number> {
  const end = new Date(); end.setUTCDate(end.getUTCDate() - 2);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - 60);
  const pts = await fetchDailyMetrics(locationId, start, end);
  for (const p of pts) run('INSERT INTO metrics (location_id, day, metric, value) VALUES (?,?,?,?) ON CONFLICT(location_id, day, metric) DO UPDATE SET value = excluded.value', locationId, p.day, p.metric, p.value);
  updateConfig(locationId, { metrics_synced_at: new Date().toISOString() });
  log('metrics', 'ok', `${pts.length} points`, locationId);
  return pts.length;
}

export type MetricSummary = { key: string; label: string; last28: number; prev28: number; series: number[] };

/** 28-day totals per group with the previous 28 days for comparison, plus a daily series for a sparkline. */
export function summary(locationId: string): MetricSummary[] {
  const rows = all<{ day: string; metric: DailyMetric; value: number }>(`SELECT day, metric, value FROM metrics WHERE location_id = ? AND day >= date('now', '-58 days') ORDER BY day`, locationId);
  if (!rows.length) return [];
  const days = [...new Set(rows.map(r => r.day))].sort();
  const cut = days.length > 28 ? days[days.length - 28] : days[0];
  return METRIC_GROUPS.map(g => {
    const mine = rows.filter(r => g.metrics.includes(r.metric));
    const byDay = new Map<string, number>();
    for (const r of mine) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.value);
    const last28 = [...byDay].filter(([d]) => d >= cut).reduce((s, [, v]) => s + v, 0);
    const prev28 = [...byDay].filter(([d]) => d < cut).reduce((s, [, v]) => s + v, 0);
    return { key: g.key, label: g.label, last28, prev28, series: days.filter(d => d >= cut).map(d => byDay.get(d) ?? 0) };
  });
}

export { DAILY_METRICS };
