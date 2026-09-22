import { all } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default function JobsPage() {
  const rows = all<{ id: number; job: string; location_id: string | null; status: string; detail: string | null; ran_at: string; title: string | null }>(
    'SELECT j.*, l.title FROM job_log j LEFT JOIN locations l ON l.id = j.location_id ORDER BY j.id DESC LIMIT 300');
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Job log</h1>
      <div className="panel overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs muted uppercase text-left"><tr><th className="px-4 py-2">When</th><th className="px-4 py-2">Job</th><th className="px-4 py-2">Location</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Detail</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t" style={{ borderColor: 'var(--line-soft)' }}>
                <td className="px-4 py-1.5 muted whitespace-nowrap">{r.ran_at}</td>
                <td className="px-4 py-1.5">{r.job}</td>
                <td className="px-4 py-1.5 muted">{r.title ?? ''}</td>
                <td className="px-4 py-1.5"><span className={`pill ${r.status === 'ok' ? 'good' : r.status === 'error' ? 'bad' : ''}`}>{r.status}</span></td>
                <td className="px-4 py-1.5 muted">{r.detail}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="px-4 py-6 muted text-center" colSpan={5}>Nothing has run yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
