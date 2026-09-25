import { all, run, log } from './db';
import type { LocationRow } from './locations';

/**
 * Alerts: things that need a person. Today, one kind: a new 1 or 2 star review. It shows on the
 * dashboard, in the sidebar and on the business's Reviews tab until marked as seen, and becomes a
 * task and a note in GoHighLevel when the business has been pushed there.
 */
export type AlertRow = {
  id: number; location_id: string; kind: string; ref: string; title: string; detail: string | null;
  created_at: string; seen_at: string | null; ghl_status: string | null; ghl_detail: string | null;
};

/**
 * Only reviews Google dates in the last 14 days raise an alert, so linking a business with years of
 * reviews, whose first check reads them all as new, does not bury the dashboard in old ones.
 */
const FRESH_DAYS = 14;

export async function alertBadReview(l: LocationRow, r: { id: string; rating: number; reviewer: string; comment: string; createTime: string | null }): Promise<boolean> {
  if (r.rating < 1 || r.rating > 2) return false;
  const age = r.createTime ? (Date.now() - Date.parse(r.createTime)) / 86_400_000 : 0;
  if (age > FRESH_DAYS) return false;
  const title = `${r.rating}-star review for ${l.title} from ${r.reviewer}`;
  const detail = r.comment.trim() ? r.comment.trim().slice(0, 600) : 'No written review, just the star rating.';
  const res = run('INSERT OR IGNORE INTO alerts (location_id, kind, ref, title, detail) VALUES (?,?,?,?,?)', l.id, 'bad_review', r.id, title, detail);
  if (!Number(res.changes)) return false;
  const id = Number(res.lastInsertRowid);
  log('alert', 'ok', title, l.id);
  try {
    // Loaded when needed: ghl pulls in the report builder, which this module should not depend on.
    const { notifyBadReview } = await import('./ghl');
    const out = await notifyBadReview(l, { title, detail, rating: r.rating });
    run('UPDATE alerts SET ghl_status = ?, ghl_detail = ? WHERE id = ?', out.status, out.detail, id);
  } catch (e: any) {
    run('UPDATE alerts SET ghl_status = ?, ghl_detail = ? WHERE id = ?', 'error', e?.message ?? String(e), id);
    log('alert', 'error', `GoHighLevel: ${e?.message ?? e}`, l.id);
  }
  return true;
}

/** Alerts not yet marked as seen, newest first, with the business name. */
export function openAlerts(locationId?: string): (AlertRow & { business: string })[] {
  return all<AlertRow & { business: string }>(
    `SELECT a.*, l.title AS business FROM alerts a JOIN locations l ON l.id = a.location_id
     WHERE a.seen_at IS NULL ${locationId ? 'AND a.location_id = ?' : ''} ORDER BY a.id DESC`,
    ...(locationId ? [locationId] : [])
  );
}

export function unseenCounts(): Map<string, number> {
  return new Map(all<{ location_id: string; n: number }>('SELECT location_id, COUNT(*) AS n FROM alerts WHERE seen_at IS NULL GROUP BY location_id').map(r => [r.location_id, r.n]));
}

export function markSeen(id: number) { run(`UPDATE alerts SET seen_at = datetime('now') WHERE id = ?`, id); }
export function markAllSeen(locationId?: string) {
  if (locationId) run(`UPDATE alerts SET seen_at = datetime('now') WHERE seen_at IS NULL AND location_id = ?`, locationId);
  else run(`UPDATE alerts SET seen_at = datetime('now') WHERE seen_at IS NULL`);
}
