import { log } from './db';
import { googleReady, viaPipedream } from './gauth';
import { hasLLM } from './llm';
import { location, locations, isLinked } from './locations';
import { poll } from './reviews';
import { runWeekly } from './posts';
import { runPhotoSchedule, syncMetrics, syncPhotos } from './extras';
import { recordWeeklyScores } from './history';
import { withUsage } from './usage';
import { due as keywordsDue, runKeywords } from './keywords';
import { gridDue, rerunLast } from './grid';

/**
 * In-process scheduler. Runs while `next dev` / `next start` is up, which for a local app means
 * "while the PC is on". Every tick checks each location for two things: reviews to poll (hourly)
 * and a weekly post that is due. A missed slot is caught up on the next tick, not skipped.
 */
export const REVIEW_POLL_MINUTES = 60;
/** Through Pipedream every token costs a credit, so reviews are checked once per window instead. */
export const PIPEDREAM_REVIEW_POLL_MINUTES = 180;
/**
 * After a daily read (stats, photos) fails for a business, the scheduler leaves it this long before
 * trying again. Without it a profile Google refuses was retried, and logged, every five minutes, and
 * in Pipedream mode its retry could spend a token on its own. A manual tick always retries.
 */
export const RETRY_AFTER_FAIL_MINUTES = 360;

export async function tick(opts: { manual?: boolean } = {}): Promise<string[]> {
  // On globalThis, not in this module: after a code change a fresh copy of this module is loaded,
  // and a module-level flag would let the new copy start a tick while the old one is still running.
  if (globalThis.__gbpTickRunning) return ['skipped: previous tick still running'];
  globalThis.__gbpTickRunning = true;
  const out: string[] = [];
  try {
    // The weekly score is recorded whatever else happens; it needs no Google call.
    try { const n = recordWeeklyScores(); if (n) out.push(`weekly score recorded for ${n} business${n === 1 ? '' : 'es'}`); }
    catch (e: any) { out.push(`score history error ${e.message}`); log('history', 'error', e.message); }
    // Only the replies and the weekly post are written by the AI. Without a key everything else
    // still runs: the stats, the photo check and queue, the weekly searches, the monthly map.
    const ai = hasLLM();
    if (!ai) out.push('no AI key: review replies and the weekly post are waiting');
    const now = Date.now();
    type Loc = ReturnType<typeof locations>[number];
    const failures = (globalThis.__gbpFailures ??= new Map<string, number>());
    const resting = (job: string, l: Loc) => !opts.manual && now - (failures.get(`${job}:${l.id}`) ?? 0) < RETRY_AFTER_FAIL_MINUTES * 60_000;
    const outcome = (job: string, l: Loc, ok: boolean) => { if (ok) failures.delete(`${job}:${l.id}`); else failures.set(`${job}:${l.id}`, now); };
    const photosDue = (l: Loc) => !resting('photos', l) && now - (l.photos_synced_at ? new Date(l.photos_synced_at + 'Z').getTime() : 0) > 24 * 60 * 60_000;
    const metricsDue = (l: Loc) => !resting('metrics', l) && now - (l.metrics_synced_at ? new Date(l.metrics_synced_at).getTime() : 0) > 24 * 60 * 60_000;
    const pollMinutes = viaPipedream() ? PIPEDREAM_REVIEW_POLL_MINUTES : REVIEW_POLL_MINUTES;
    const reviewsDue = (l: ReturnType<typeof locations>[number]) =>
      now - (l.last_review_poll ? new Date(l.last_review_poll + 'Z').getTime() : 0) > pollMinutes * 60_000;
    const googleDue = locations().filter(isLinked).some(l =>
      reviewsDue(l) ||
      (l.next_post_at && new Date(l.next_post_at).getTime() <= now) ||
      metricsDue(l) ||
      photosDue(l));
    // Only ask for Google access when something is due: through Pipedream each token costs a credit.
    const google = googleDue ? await googleReady(opts.manual ? 'manual' : 'scheduler') : { ok: true as boolean, why: undefined as string | undefined };
    if (!google.ok) out.push(`Google jobs waiting: ${google.why}`);
    for (const { id } of locations()) {
      // Each business is read again at its own turn. A round with several businesses takes minutes,
      // and working from the copy made at the start meant a setting saved in that time (automatic
      // replies off, the weekly post off) was ignored for the rest of the round.
      const l = location(id);
      if (!l) continue;
      // Weekly search check: tracked clients, linked or hand-added; prospects are created with it off.
      if (keywordsDue(l)) {
        try { const s = await withUsage(l.id, 'searches', () => runKeywords(l.id)); out.push(`${l.title}: searches checked, share ${s.visibility}%`); }
        catch (e: any) { out.push(`${l.title}: search check error ${e.message}`); }
      }
      // Monthly map re-check, only where switched on; it starts in the background and is not awaited.
      if (gridDue(l)) {
        try { rerunLast(l.id); out.push(`${l.title}: map re-check started`); }
        catch (e: any) { out.push(`${l.title}: map error ${e.message}`); }
      }
      if (!isLinked(l) || !google.ok) continue;
      if (ai && reviewsDue(l)) {
        try { const r = await withUsage(l.id, 'review replies', () => poll(l.id)); out.push(`${l.title}: reviews ${r.fetched} fetched, ${r.posted} replied`); }
        catch (e: any) { out.push(`${l.title}: reviews error ${e.message}`); log('reviews', 'error', e.message, l.id); }
      }
      if (ai && l.next_post_at && new Date(l.next_post_at).getTime() <= now) {
        try { out.push(`${l.title}: post ${await withUsage(l.id, 'weekly post', () => runWeekly(l))}`); }
        catch (e: any) { out.push(`${l.title}: post error ${e.message}`); log('post', 'error', e.message, l.id); }
      }
      try { const r = await runPhotoSchedule(l); if (r) out.push(`${l.title}: ${r}`); }
      catch (e: any) { out.push(`${l.title}: photo error ${e.message}`); }
      if (metricsDue(l)) {
        try { await syncMetrics(l.id); outcome('metrics', l, true); out.push(`${l.title}: metrics synced`); }
        catch (e: any) { outcome('metrics', l, false); out.push(`${l.title}: metrics error ${e.message}`); log('metrics', 'error', e.message, l.id); }
      }
      if (photosDue(l)) {
        try { const p = await syncPhotos(l.id); outcome('photos', l, true); out.push(`${l.title}: ${p.count} photos`); }
        catch (e: any) { outcome('photos', l, false); out.push(`${l.title}: photos error ${e.message}`); log('photos', 'error', e.message, l.id); }
      }
    }
  } finally {
    globalThis.__gbpTickRunning = false;
  }
  return out;
}

declare global {
  // eslint-disable-next-line no-var
  var __gbpScheduler: NodeJS.Timeout | undefined;
  // eslint-disable-next-line no-var
  var __gbpTickRunning: boolean | undefined;
  // eslint-disable-next-line no-var
  var __gbpFailures: Map<string, number> | undefined;
}

/**
 * The timer is created by the code loaded when the server starts, and in development that code is
 * never reloaded. A timer that called tick() itself kept running the version from start-up after
 * every change: on 2026-09-22 the review checks failed every 5 minutes for an hour because the timer
 * still ran code from before the switch to Pipedream. So the timer only asks the app's own action
 * route to run a tick; the route always runs the current code.
 */
async function knock() {
  const port = process.env.PORT || '3320';
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'scheduler.auto' }),
      cache: 'no-store',
    });
    if (!res.ok) log('scheduler', 'error', `The app answered HTTP ${res.status} when asked to run the scheduler`);
  } catch (e: any) {
    log('scheduler', 'error', `Could not reach the app to run the scheduler: ${e?.message ?? e}`);
  }
}

export function start(intervalMinutes = 5) {
  if (globalThis.__gbpScheduler) return;
  globalThis.__gbpScheduler = setInterval(() => { void knock(); }, intervalMinutes * 60_000);
  setTimeout(() => { void knock(); }, 20_000);
}
