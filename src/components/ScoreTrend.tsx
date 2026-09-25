import type { WeekScore } from '@/lib/history';
import { weekLabel } from '@/lib/history';

/** The weekly score as a small line, with the change since the previous recorded week. */
export default function ScoreTrend({ points }: { points: WeekScore[] }) {
  if (points.length === 0) return <p className="text-xs muted">The weekly score history starts this week.</p>;
  if (points.length === 1) {
    return <p className="text-xs muted">Weekly score: {points[0].score} for the week of {weekLabel(points[0].week)}. A trend line appears once next week’s score is recorded.</p>;
  }
  const W = 220, H = 44, pad = 5;
  const scores = points.map(p => p.score);
  const lo = Math.max(0, Math.min(Math.min(...scores) - 5, Math.max(...scores) - 20));
  const hi = Math.min(100, Math.max(Math.max(...scores) + 5, lo + 20));
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (points.length - 1);
  const y = (s: number) => H - pad - ((s - lo) / (hi - lo)) * (H - 2 * pad);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.score).toFixed(1)}`).join(' ');
  const last = points[points.length - 1], prev = points[points.length - 2];
  const delta = last.score - prev.score;
  return (
    <div className="flex items-center gap-3 flex-wrap text-xs">
      <span className="font-medium">Weekly score</span>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Weekly scores: ${points.map(p => `week of ${weekLabel(p.week)} ${p.score}`).join(', ')}`}>
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={p.week} cx={x(i)} cy={y(p.score)} r={i === points.length - 1 ? 3.5 : 2.2} fill="var(--accent)">
            <title>{`Week of ${weekLabel(p.week)}: ${p.score}`}</title>
          </circle>
        ))}
      </svg>
      <span className="score font-semibold" style={{ color: delta > 0 ? 'var(--good)' : delta < 0 ? 'var(--bad)' : 'var(--muted)' }}>
        {delta > 0 ? `Up ${delta}` : delta < 0 ? `Down ${-delta}` : 'No change'} since the week of {weekLabel(prev.week)}
      </span>
    </div>
  );
}
