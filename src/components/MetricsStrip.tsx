import Action from './Action';
import type { MetricSummary } from '@/lib/extras';

function Spark({ series }: { series: number[] }) {
  const w = 84, h = 22, max = Math.max(1, ...series);
  const pts = series.map((v, i) => `${(i / Math.max(1, series.length - 1)) * w},${h - (v / max) * h}`).join(' ');
  return <svg width={w} height={h} className="opacity-70" aria-hidden><polyline fill="none" stroke="var(--info)" strokeWidth="1.5" points={pts} /></svg>;
}

/**
 * What customers did on the profile in the last 28 days, against the 28 before it. Anything that has
 * not happened at all in either period is left out: a row of zeroes tells nobody anything.
 */
export default function MetricsStrip({ id, items, syncedAt }: { id: string; items: MetricSummary[]; syncedAt: string | null }) {
  const shown = items.filter(m => m.last28 > 0 || m.prev28 > 0);
  return (
    <section aria-labelledby="stats-h" className="panel px-5 py-4">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <h2 id="stats-h" className="text-sm font-semibold">Last 28 days on Google</h2>
        <span className="flex items-center gap-2 text-xs muted">
          {syncedAt && <span>Read {syncedAt.slice(0, 10)}</span>}
          <Action action="metrics.sync" params={{ id }} className="btn sm" busy="Reading…">Update</Action>
        </span>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm muted mt-2">Nothing from Google yet. Press Update to read the last few weeks.</p>
      ) : (
        <div className="mt-3 flex gap-x-10 gap-y-4 flex-wrap">
          {shown.map(m => {
            const d = m.prev28 ? Math.round(((m.last28 - m.prev28) / m.prev28) * 100) : null;
            return (
              <div key={m.key} className="flex items-center gap-3">
                <div>
                  <div className="text-xs muted">{m.label}</div>
                  <div className="text-lg font-semibold score">
                    {m.last28.toLocaleString('en-GB')}
                    {d !== null && d !== 0 && (
                      <span className="text-xs ml-2 font-medium" style={{ color: d > 0 ? 'var(--good)' : 'var(--bad)' }}>
                        {d > 0 ? 'up' : 'down'} {Math.abs(d)}%
                      </span>
                    )}
                  </div>
                </div>
                <Spark series={m.series} />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
