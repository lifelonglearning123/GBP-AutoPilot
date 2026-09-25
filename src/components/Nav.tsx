import Link from 'next/link';
import { locations } from '@/lib/locations';
import { listConnections, viaPipedream } from '@/lib/gauth';
import { isMock } from '@/lib/gbp';
import { hasLLM } from '@/lib/llm';
import { audit, LOW_COVERAGE } from '@/lib/audit';
import { locParam } from '@/lib/ids';
import { unseenCounts } from '@/lib/alerts';

export default function Nav() {
  const locs = locations();
  const conns = listConnections();
  const mock = isMock();
  const alertCount = unseenCounts();
  return (
    <aside className="w-64 shrink-0 border-r px-4 py-6 flex flex-col gap-6 sticky top-0 h-screen overflow-y-auto" style={{ borderColor: 'var(--line)', background: 'var(--panel-2)' }}>
      <div>
        <Link href="/" className="block" style={{ marginLeft: -4 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/lockup.svg" alt="GBP Autopilot" style={{ height: 34, width: 'auto' }} />
        </Link>
        <div className="text-xs muted mt-1">Local SEO, on a schedule</div>
      </div>

      <div className="flex flex-col gap-1">
        <Link href="/" className="tab">Dashboard</Link>
        <Link href="/prospects" className="tab">Prospecting</Link>
        <Link href="/jobs" className="tab">Job log</Link>
        <Link href="/usage" className="tab">Running costs</Link>
        <Link href="/settings" className="tab">Settings</Link>
        <Link href="/help" className="tab">Help</Link>
      </div>

      <div>
        <div className="text-xs font-semibold muted mb-2 px-1">Locations</div>
        <div className="flex flex-col gap-1">
          {locs.length === 0 && <div className="text-sm muted">None synced yet</div>}
          {locs.map(l => {
            const { score, coverage } = audit(l);
            const partial = coverage < LOW_COVERAGE;
            return (
              <Link key={l.id} href={`/locations/${locParam(l.id)}`} className="tab flex items-center justify-between gap-2">
                <span className="truncate flex items-center gap-1.5">
                  {alertCount.get(l.id) ? <span className="shrink-0 w-2 h-2 rounded-full" style={{ background: 'var(--bad)' }} title={`${alertCount.get(l.id)} new bad review${alertCount.get(l.id) === 1 ? '' : 's'}`} aria-label="New bad review" /> : null}
                  <span className="truncate">{l.title}</span>
                </span>
                <span className={`pill ${partial ? '' : score >= 80 ? 'good' : score >= 50 ? 'warn' : 'bad'}`} title={partial ? `Only ${coverage}% of the checklist could be scored` : undefined}>{partial ? `${score}?` : score}</span>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="mt-auto text-xs flex flex-col gap-1">
        <div><span className={`pill ${mock ? 'warn' : 'good'}`}>{mock ? 'Mock mode' : 'Live'}</span></div>
        <div className="muted truncate">{viaPipedream() ? 'Google: via Pipedream' : conns.length === 1 ? `Google: ${conns[0].email ?? 'connected'}` : conns.length ? `Google: ${conns.length} accounts` : 'Google: not connected'}</div>
        <div className="muted">{hasLLM() ? 'LLM: ready' : 'LLM: no key'}</div>
      </div>
    </aside>
  );
}
