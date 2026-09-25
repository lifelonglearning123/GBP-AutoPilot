import Link from 'next/link';
import Action from './Action';
import type { AlertRow } from '@/lib/alerts';
import { locParam } from '@/lib/ids';

const GHL: Record<string, string> = {
  sent: 'Also added to GoHighLevel as a task.',
  skipped: '',
  error: 'Could not add it to GoHighLevel.',
};

/** New bad reviews, each with a way to answer it and a way to clear it. */
export default function AlertList({ alerts, showBusiness = true }: { alerts: (AlertRow & { business: string })[]; showBusiness?: boolean }) {
  if (!alerts.length) return null;
  return (
    <section aria-labelledby="alerts-h" className="rounded-xl border p-4 flex flex-col gap-3" style={{ borderColor: 'var(--bad-line)', background: 'var(--bad-bg)' }}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 id="alerts-h" className="text-base font-semibold" style={{ color: 'var(--bad)' }}>
          {alerts.length === 1 ? 'A new bad review needs a reply' : `${alerts.length} new bad reviews need a reply`}
        </h2>
        {alerts.length > 1 && (
          <Action action="alerts.seenAll" params={showBusiness ? {} : { locationId: alerts[0].location_id }} className="btn sm">Mark all as seen</Action>
        )}
      </div>
      <ul className="flex flex-col gap-2">
        {alerts.map(a => (
          <li key={a.id} className="bg-white rounded-lg border p-3 flex items-start justify-between gap-3 flex-wrap" style={{ borderColor: 'var(--bad-line)' }}>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{showBusiness ? a.title : a.title.replace(` for ${a.business}`, '')}</div>
              <p className="text-sm muted mt-0.5 max-w-prose">“{a.detail}”</p>
              {a.ghl_status && GHL[a.ghl_status] && (
                <p className="text-xs mt-1" style={{ color: a.ghl_status === 'error' ? 'var(--bad)' : 'var(--muted)' }} title={a.ghl_detail ?? ''}>{GHL[a.ghl_status]}</p>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              {showBusiness && <Link className="btn sm primary" href={`/locations/${locParam(a.location_id)}/reviews`}>Reply</Link>}
              <Action action="alerts.seen" params={{ id: a.id }} className="btn sm">Mark as seen</Action>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
