import { all, one, run, log } from './db';
import { json as llmJson } from './llm';
import { location, view, updateConfig, type LocationRow } from './locations';
import { listMedia, customerMediaCount, createPhoto, fetchDailyMetrics, DAILY_METRICS, type DailyMetric } from './gbp';

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

// ======================= Photo check =======================

/**
 * Read how many photos the business has added and when the newest went up, for the audit's photo
 * check (10 or more, and a new one every month). Customer photos are counted too, for the note.
 */
export async function syncPhotos(locationId: string): Promise<{ count: number; latest: string | null }> {
  const l = location(locationId);
  if (!l) throw new Error('Unknown location');
  const { items, total } = await listMedia(l.account, l.id);
  const photos = items.filter(m => (m.mediaFormat ?? 'PHOTO') === 'PHOTO');
  // When Google has more than was read, trust its total for the count.
  const count = items.length < total ? total - (items.length - photos.length) : photos.length;
  const latest = photos.map(m => m.createTime ?? '').filter(Boolean).sort().pop() ?? null;
  let customers: number | null = null;
  try { customers = await customerMediaCount(l.account, l.id); } catch { /* optional */ }
  run(`UPDATE locations SET photos_count = ?, photos_customer_count = ?, photos_latest_at = ?, photos_synced_at = datetime('now') WHERE id = ?`,
    count, customers, latest, l.id);
  log('photos', 'ok', `${count} photos from the business${customers !== null ? `, ${customers} from customers` : ''}; newest ${latest ? latest.slice(0, 10) : 'none'}`, l.id);
  return { count, latest };
}
