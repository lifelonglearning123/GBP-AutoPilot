import type { AuditItem } from '@/lib/audit';
import { groupTotals } from '@/lib/audit';
import { pts as fmt } from '@/lib/format';

const ICON = { good: '✓', partial: '◐', poor: '✗', unknown: '?' } as const;
const TONE = { good: 'var(--good)', partial: 'var(--warn)', poor: 'var(--bad)', unknown: 'var(--muted)' } as const;

/** Graded checklist, grouped, with the points each item earned so the score can be traced line by line. */
export default function Checklist({ items }: { items: AuditItem[] }) {
  return (
    <div className="flex flex-col gap-4">
      {groupTotals(items).map(g => (
        <div key={g.group}>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-xs muted uppercase tracking-wide">{g.group}</span>
            <span className="text-xs muted score">
              {g.knownWeight ? <>{fmt(g.earned)} / {fmt(g.knownWeight)}</> : 'not checked'}
              {g.knownWeight > 0 && g.knownWeight < g.weight && <> <span title="Some checks in this group could not be seen">of {fmt(g.weight)}</span></>}
            </span>
          </div>
          <ul className="flex flex-col gap-1.5">
            {g.items.map(i => (
              <li key={i.key} className="panel-2 px-3 py-2 flex gap-3" style={{ opacity: i.unknown ? 0.55 : 1 }}>
                <span className="mt-0.5 w-4 text-center" style={{ color: TONE[i.grade] }}>{ICON[i.grade]}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{i.label}</span>
                    <span className="text-xs muted score whitespace-nowrap">{i.unknown ? 'not checked' : `${fmt(i.points * i.weight)} / ${fmt(i.weight)}`}</span>
                  </div>
                  {!i.unknown && i.weight >= 4 && (
                    <div className="h-1 rounded mt-1.5 mb-1" style={{ background: 'var(--line)' }}>
                      <div className="h-1 rounded" style={{ width: `${Math.round(i.points * 100)}%`, background: TONE[i.grade] }} />
                    </div>
                  )}
                  <div className="text-xs muted">{i.note}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
