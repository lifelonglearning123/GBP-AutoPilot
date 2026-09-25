import type { AuditItem } from '@/lib/audit';
import { groupTotals } from '@/lib/audit';
import { pts } from '@/lib/format';
import { GROUP_LABEL } from '@/lib/steps';
import type { WeekScore } from '@/lib/history';
import ScoreTrend from './ScoreTrend';

const HATCH = 'repeating-linear-gradient(135deg, #e9ebf0 0 4px, #f7f7fa 4px 8px)';

/**
 * The 100 points laid out as one bar, each scoring area as wide as the points it carries, filled by
 * what the business earns. It answers "why this score" at a glance: the empty stretches are where
 * the points are being lost.
 */
export default function ScoreRuler({ items, score, coverage, history = [] }: { items: AuditItem[]; score: number; coverage: number; history?: WeekScore[] }) {
  const groups = groupTotals(items).sort((a, b) => b.weight - a.weight);
  const worst = groups
    .map(g => ({ g, lost: g.knownWeight - g.earned }))
    .filter(x => x.lost > 0.05)
    .sort((a, b) => b.lost - a.lost)[0];
  const summary = worst
    ? `Most points are being missed on ${GROUP_LABEL[worst.g.group].toLowerCase()}: ${pts(worst.g.earned)} of ${pts(worst.g.weight)}.`
    : 'Everything we can check is earning full points.';

  return (
    <section aria-labelledby="ruler-h" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-x-6 gap-y-1 flex-wrap">
        <h3 id="ruler-h" className="font-semibold">Where the points come from</h3>
        <p className="text-sm muted">
          <span className="display font-semibold score" style={{ color: 'var(--text)' }}>{score} out of 100</span>
          {coverage < 100 ? `, scored on the ${coverage} points the app can check.` : '.'} {summary}
        </p>
      </div>

      <div className="flex w-full gap-[3px]" role="img"
        aria-label={groups.map(g => `${GROUP_LABEL[g.group]}: ${g.knownWeight ? `${pts(g.earned)} of ${pts(g.weight)}` : 'not checked'}`).join('; ')}>
        {groups.map(g => {
          const earned = g.weight ? (g.earned / g.weight) * 100 : 0;
          const unknown = g.weight ? ((g.weight - g.knownWeight) / g.weight) * 100 : 0;
          return (
            <div key={g.group} className="flex h-3.5 overflow-hidden rounded-[4px]" style={{ flex: `${g.weight} 1 0` }}>
              <div style={{ width: `${earned}%`, background: 'var(--accent)' }} />
              <div style={{ flex: '1 1 0', background: '#e6e7ee' }} />
              {unknown > 0 && <div style={{ width: `${unknown}%`, background: HATCH }} />}
            </div>
          );
        })}
      </div>

      <div className="hidden md:flex w-full gap-[3px]" aria-hidden="true">
        {groups.map(g => (
          <div key={g.group} className="min-w-0" style={{ flex: `${g.weight} 1 0` }}>
            <div className="text-[13px] font-medium leading-tight">{GROUP_LABEL[g.group]}</div>
            <div className="text-xs muted score">{g.knownWeight ? `${pts(g.earned)} of ${pts(g.weight)}` : 'not checked'}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-5 text-xs muted flex-wrap">
        <span className="flex items-center gap-1.5"><i className="inline-block w-3 h-2.5 rounded-sm" style={{ background: 'var(--accent)' }} />Earned</span>
        <span className="flex items-center gap-1.5"><i className="inline-block w-3 h-2.5 rounded-sm" style={{ background: '#e6e7ee' }} />Missed</span>
        <span className="flex items-center gap-1.5"><i className="inline-block w-3 h-2.5 rounded-sm" style={{ background: HATCH }} />Not checked, left out of the score</span>
      </div>
      <ScoreTrend points={history} />
    </section>
  );
}
