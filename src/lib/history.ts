import { all, one, run } from './db';
import { ukParts } from './uktime';
import { locations } from './locations';
import { audit, groupTotals } from './audit';

/**
 * Weekly score history: one row per business per week, keyed by the Monday the week starts (local
 * time). The current week's row is refreshed as the week goes on, at most every six hours, so each
 * finished week keeps the score it ended on and the trend reads week by week, not day by day.
 */
export function weekOf(d = new Date()): string {
  // The week is Britain's, not the server's: on a server in UTC it began at 01:00 on a summer Monday.
  const p = ukParts(d);
  const x = new Date(Date.UTC(p.year, p.month - 1, p.day - ((p.weekday + 6) % 7)));
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
}

/** Record this week's score for every business. Cheap: it skips rows refreshed in the last six hours. */
export function recordWeeklyScores(): number {
  const week = weekOf();
  let n = 0;
  for (const l of locations()) {
    const row = one<{ taken_at: string }>('SELECT taken_at FROM score_history WHERE location_id = ? AND week = ?', l.id, week);
    if (row && Date.now() - Date.parse(row.taken_at.replace(' ', 'T') + 'Z') < 6 * 3_600_000) continue;
    const a = audit(l);
    const groups = groupTotals(a.items).map(g => ({ group: g.group, earned: Math.round(g.earned * 10) / 10, weight: g.weight, known: g.knownWeight }));
    run(`INSERT INTO score_history (location_id, week, score, coverage, groups_json) VALUES (?,?,?,?,?)
         ON CONFLICT(location_id, week) DO UPDATE SET score = excluded.score, coverage = excluded.coverage,
           groups_json = excluded.groups_json, taken_at = datetime('now')`,
      l.id, week, a.score, a.coverage, JSON.stringify(groups));
    n++;
  }
  return n;
}

export type WeekScore = { week: string; score: number; coverage: number };

/** The last `weeks` recorded weeks for a business, oldest first. */
export function scoreHistory(locationId: string, weeks = 12): WeekScore[] {
  return all<WeekScore>('SELECT week, score, coverage FROM score_history WHERE location_id = ? ORDER BY week DESC LIMIT ?', locationId, weeks).reverse();
}

/** This week's score against the previous recorded week, when there is one. */
export function weeklyChange(locationId: string): { score: number; delta: number; since: string } | null {
  const h = scoreHistory(locationId, 2);
  return h.length === 2 ? { score: h[1].score, delta: h[1].score - h[0].score, since: h[0].week } : null;
}

export const weekLabel = (w: string) => new Date(`${w}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** The weekly scores as a small line chart (SVG markup), for the client report. */
export function trendSvg(points: WeekScore[], w = 360, h = 70): string {
  if (points.length < 2) return '';
  const pad = 8;
  const min = Math.min(...points.map(p => p.score)), max = Math.max(...points.map(p => p.score));
  const lo = Math.max(0, Math.min(min - 5, max - 20)), hi = Math.min(100, Math.max(max + 5, lo + 20));
  const x = (i: number) => pad + (i * (w - 2 * pad)) / (points.length - 1);
  const y = (s: number) => h - pad - ((s - lo) / (hi - lo)) * (h - 2 * pad);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.score).toFixed(1)}`).join(' ');
  const dots = points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.score).toFixed(1)}" r="${i === points.length - 1 ? 4 : 2.5}" fill="#5646e8"><title>Week of ${weekLabel(p.week)}: ${p.score}</title></circle>`).join('');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Score by week"><path d="${d}" fill="none" stroke="#5646e8" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${dots}</svg>`;
}
