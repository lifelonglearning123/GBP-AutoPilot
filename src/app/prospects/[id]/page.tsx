import Link from 'next/link';
import { notFound } from 'next/navigation';
import { batch, prospects, isRunning } from '@/lib/prospects';
import { locParam } from '@/lib/ids';
import BatchControls from '@/components/BatchControls';
import Action from '@/components/Action';
import { agency } from '@/lib/agency';

export const dynamic = 'force-dynamic';

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = batch(Number(id));
  if (!b) notFound();
  const rows = prospects(b.id);
  const running = isRunning(b.id);
  const done = rows.filter(r => r.status === 'done' || r.status === 'error').length;
  const queued = rows.filter(r => r.status === 'queued').length;
  const ghlReady = Boolean(agency().ghl_token && agency().ghl_location_id);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs muted"><Link href="/prospects" className="underline">Prospecting</Link> / batch {b.id}</div>
          <h1 className="text-2xl font-semibold">{b.name}</h1>
          <div className="text-sm muted mt-1">{rows.length} businesses · {done} audited · {queued} queued · budget {b.budget}</div>
        </div>
        <BatchControls id={b.id} budget={b.budget} running={running} queued={queued} done={done} errors={rows.filter(r => r.status === 'error').length} />
      </div>

      <div className="panel overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs muted uppercase text-left">
            <tr><th className="px-4 py-2">Business</th><th className="px-4 py-2">Google rating</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Score</th><th className="px-4 py-2">Citations</th><th className="px-4 py-2"></th></tr>
          </thead>
          <tbody>
            {rows.map(p => (
              <tr key={p.id} className="border-t align-top" style={{ borderColor: 'var(--line-soft)', opacity: p.status === 'skipped' ? 0.5 : 1 }}>
                <td className="px-4 py-2">
                  {p.location_id ? <Link href={`/locations/${locParam(p.location_id)}/citations`} className="underline font-medium">{p.title}</Link> : <span className="font-medium">{p.title}</span>}
                  <div className="text-xs muted">{[p.street, p.town, p.postcode].filter(Boolean).join(', ')}{p.phone ? ` · ${p.phone}` : ''}{p.website ? '' : ' · no website'}</div>
                  {p.error && <div className="text-xs" style={{ color: 'var(--bad)' }}>{p.error}</div>}
                </td>
                <td className="px-4 py-2 muted">{p.rating ? `${p.rating}★ (${p.rating_count ?? 0})` : '—'}</td>
                <td className="px-4 py-2"><span className={`pill ${p.status === 'done' ? 'good' : p.status === 'running' ? 'info' : p.status === 'error' ? 'bad' : ''}`}>{p.status}</span></td>
                <td className="px-4 py-2 score">{p.score ?? ''}</td>
                <td className="px-4 py-2">{p.status === 'done' ? <><span style={{ color: p.mismatches ? 'var(--bad)' : 'var(--good)' }}>{p.mismatches} wrong</span> <span className="muted">/ {p.found} found</span></> : ''}</td>
                <td className="px-4 py-2">
                  <div className="flex gap-1 justify-end">
                    {p.status === 'queued' && <Action action="prospects.skip" params={{ id: p.id }} className="btn sm">Skip</Action>}
                    {p.status === 'skipped' && <Action action="prospects.unskip" params={{ id: p.id }} className="btn sm">Queue</Action>}
                    {p.location_id && <a className="btn sm" href={`/api/report/${encodeURIComponent(p.location_id)}`} target="_blank" rel="noopener">Report</a>}
                    {p.location_id && ghlReady && <Action action="ghl.push" params={{ id: p.location_id }} className="btn sm primary" busy="Pushing…" confirm="Push this business and its report into GHL?">GHL</Action>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
