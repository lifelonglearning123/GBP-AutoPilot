import Link from 'next/link';
import { batches } from '@/lib/prospects';
import NewBatch from '@/components/NewBatch';

export const dynamic = 'force-dynamic';

export default function ProspectsPage() {
  const rows = batches();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Prospecting</h1>
        <p className="muted text-sm mt-1">Audit a list of businesses in bulk. Each one becomes a manual location with a citation audit and a report; the worst profiles rank first.</p>
      </div>
      <NewBatch hasSerper={Boolean(process.env.SERPER_API_KEY)} />
      {rows.length > 0 && (
        <div className="panel overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs muted uppercase text-left"><tr><th className="px-4 py-2">Batch</th><th className="px-4 py-2">Source</th><th className="px-4 py-2">Progress</th><th className="px-4 py-2">Budget</th><th className="px-4 py-2">Status</th></tr></thead>
            <tbody>
              {rows.map(b => (
                <tr key={b.id} className="border-t" style={{ borderColor: 'var(--line-soft)' }}>
                  <td className="px-4 py-2"><Link href={`/prospects/${b.id}`} className="underline">{b.name}</Link><div className="text-xs muted">{b.created_at.slice(0, 16)}</div></td>
                  <td className="px-4 py-2 muted">{b.source}</td>
                  <td className="px-4 py-2">{b.done} / {b.total} audited</td>
                  <td className="px-4 py-2">{b.budget}</td>
                  <td className="px-4 py-2"><span className={`pill ${b.status === 'running' ? 'info' : b.status === 'done' ? 'good' : ''}`}>{b.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
