import type { AuditItem } from '@/lib/audit';
import { groupTotals } from '@/lib/audit';
import { pts } from '@/lib/format';
import StatusIcon from './StatusIcon';

/** Every check, grouped, with the points it earned: the reference behind the score. */
export default function Scorecard({ items, note }: { items: AuditItem[]; note: string }) {
  return (
    <section aria-labelledby="card-h" className="flex flex-col gap-5">
      <div>
        <h2 id="card-h" className="text-lg font-semibold">Scorecard</h2>
        <p className="text-xs muted mt-1">{note}</p>
      </div>
      {groupTotals(items).map(g => {
        // A group earning every point it can be scored on, with nothing unchecked, starts closed.
        const full = g.knownWeight > 0 && g.knownWeight === g.weight && g.earned >= g.weight - 0.01;
        return (
          <details key={g.group} open={!full} className="group">
            <summary className="flex items-center justify-between gap-2 pb-1.5 border-b cursor-pointer list-none [&::-webkit-details-marker]:hidden rounded-sm" style={{ borderColor: 'var(--line)' }}>
              <span className="flex items-center gap-2">
                {full && <StatusIcon grade="good" size={14} />}
                <h3 className="text-sm font-semibold">{g.group}</h3>
              </span>
              <span className="flex items-center gap-2">
                <span className="text-xs muted score">{g.knownWeight ? `${pts(g.earned)} of ${pts(g.weight)}` : 'not checked'}</span>
                <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true" className="transition-transform duration-200 group-open:rotate-180" style={{ color: 'var(--muted)' }}>
                  <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </summary>
            <ul className="mt-1">
              {g.items.map(i => (
                <li key={i.key} className="flex items-start gap-2 py-1.5 text-sm" title={i.note}>
                  <span className="mt-0.5"><StatusIcon grade={i.grade} size={14} /></span>
                  <span className={`flex-1 min-w-0 leading-snug ${i.unknown ? 'muted' : ''}`}>{i.label}</span>
                  <span className="text-xs muted score whitespace-nowrap mt-0.5">{i.unknown ? 'not checked' : `${pts(i.points * i.weight)} / ${pts(i.weight)}`}</span>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </section>
  );
}
