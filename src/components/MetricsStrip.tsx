import Action from './Action';
import type { MetricSummary } from '@/lib/extras';

function Spark({ series }: { series: number[] }) {
  const w = 96, h = 24, max = Math.max(1, ...series);
  const pts = series.map((v, i) => `${(i / Math.max(1, series.length - 1)) * w},${h - (v / max) * h}`).join(' ');
  return <svg width={w} height={h} className="opacity-70"><polyline fill="none" stroke="var(--info)" strokeWidth="1.5" points={pts} /></svg>;
}

/** 28-day performance from Google, with the change against the previous 28 days. */
export default function MetricsStrip({ id, items, syncedAt }: { id: string; items: MetricSummary[]; syncedAt: string | null }) {
  return (
    <div className="panel px-5 py-3 flex items-center gap-8 flex-wrap">
      {items.length === 0 && <span className="text-sm muted">No performance data yet.</span>}
      {items.map(m => {
        const d = m.prev28 ? Math.round(((m.last28 - m.prev28) / m.prev28) * 100) : null;
        return (
          <div key={m.key} className="flex items-center gap-3">
            <div>
              <div className="text-xs muted">{m.label} · 28d</div>
              <div className="text-lg font-semibold score">{m.last28}{d !== null && <span className={`text-xs ml-2 ${d >= 0 ? 'text-[var(--good)]' : 'text-[var(--bad)]'}`}>{d >= 0 ? '+' : ''}{d}%</span>}</div>
            </div>
            <Spark series={m.series} />
          </div>
        );
      })}
      <div className="ml-auto flex items-center gap-2 text-xs muted">
        {syncedAt && <span>synced {syncedAt.slice(0, 16).replace('T', ' ')}</span>}
        <Action action="metrics.sync" params={{ id }} className="btn sm" busy="Syncing…">Sync stats</Action>
      </div>
    </div>
  );
}
