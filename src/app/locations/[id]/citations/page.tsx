import { location, view } from '@/lib/locations';
import { canonical, citations, detailsChanged, latestRun, missingDirectories, DIRECTORIES } from '@/lib/citations';
import type { Canonical } from '@/lib/citations';
import { locId } from '@/lib/ids';
import { parse } from '@/lib/db';
import Action from '@/components/Action';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = { match: 'Consistent', mismatch: 'Mismatch', partial: 'Incomplete', other: 'Different business', not_listed: 'Not listed', error: 'Could not read' };
const STATUS_PILL: Record<string, string> = { match: 'good', mismatch: 'bad', partial: 'warn', other: 'info', not_listed: '', error: '' };

export default async function CitationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = location(locId(id))!;
  const v = view(l);
  const c = canonical(v);
  const run = latestRun(l.id);
  const rows = run ? citations(run.id) : [];
  const missing = run ? missingDirectories(run.id) : DIRECTORIES;
  const hasSerper = Boolean(process.env.SERPER_API_KEY);
  // Every verdict below was judged against the details as they stood when the
  // run was taken, so that is what is shown above them.
  const ran = run ? parse<Partial<Canonical>>(run.canonical_json, {}) : null;
  const changed = detailsChanged(ran, c);
  const shown = ran ?? c;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div className="text-sm">
          <div className="text-xs muted uppercase tracking-wide mb-1">
            {run ? 'Compared against, as the profile stood then' : 'Canonical NAP (from the profile)'}
          </div>
          <div><strong>{shown.name ?? c.name}</strong> · {shown.street ?? c.street}{(shown.town ?? c.town) ? `, ${shown.town ?? c.town}` : ''} {shown.postcode ?? v.address.postalCode ?? ''} · {shown.phone || 'no phone'}</div>
          {changed.length > 0 && (
            <div className="text-sm mt-1" style={{ color: 'var(--warn)' }}>
              The {changed.join(' and ')} {changed.length === 1 ? 'has' : 'have'} changed since this audit ran, so every
              verdict below is about the old one. Re-run it to see where you actually stand.
            </div>
          )}
          <div className="text-xs muted mt-1">
            {run ? <>Last audit {run.ran_at.slice(0, 16)}: {run.searched} pages checked, {run.found} citations, {run.matches} consistent, {run.mismatches} mismatched.</> : 'Not audited yet.'}
            {!hasSerper && <> · <span style={{ color: 'var(--warn)' }}>SERPER_API_KEY not set{process.env.GBP_MOCK ? ', using mock pages' : ''}.</span></>}
          </div>
        </div>
        <Action action="citations.audit" params={{ id: l.id }} className="btn primary" busy="Searching and reading pages… (1–3 min)">{run ? 'Re-run audit' : 'Run citation audit'}</Action>
      </div>

      {rows.length > 0 && (
        <section className="panel overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs muted uppercase text-left">
              <tr><th className="px-4 py-2">Site</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Listed as</th><th className="px-4 py-2">Issues</th></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t align-top" style={{ borderColor: 'var(--line-soft)', opacity: r.status === 'other' || r.status === 'not_listed' ? 0.6 : 1 }}>
                  <td className="px-4 py-2">
                    <a href={r.url} target="_blank" rel="noopener" className="underline">{r.directory ?? r.domain}</a>
                    {r.directory && <div className="text-xs muted">{r.domain}</div>}
                  </td>
                  <td className="px-4 py-2"><span className={`pill ${STATUS_PILL[r.status]}`}>{STATUS_LABEL[r.status]}</span></td>
                  <td className="px-4 py-2 text-xs">
                    {r.name_found && <div>{r.name_found}</div>}
                    {r.address_found && <div className="muted">{r.address_found}</div>}
                    {r.phone_found && <div className="muted">{r.phone_found}</div>}
                  </td>
                  <td className="px-4 py-2 text-xs" style={{ color: r.status === 'mismatch' ? 'var(--bad)' : 'var(--muted)' }}>
                    {parse<string[]>(r.issues, []).join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="panel p-5">
        <h2 className="font-semibold mb-1">Key directories {run ? 'without a listing' : 'to check'} ({missing.length})</h2>
        <p className="text-xs muted mb-3">
          The first four send customers directly and feed other sites. Claim each with the canonical NAP above, exactly as written.
          Bulk pushing the long tail is a job for a partner such as Synup or BrightLocal; re-run this audit a month later to prove it took.
        </p>
        <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {missing.map(d => (
            <a key={d.label} href={d.claim} target="_blank" rel="noopener" className="panel-2 px-3 py-2 text-sm flex justify-between gap-2 hover:border-[#303947]">
              <span>{d.label}</span><span className="text-xs muted">claim →</span>
            </a>
          ))}
          {missing.length === 0 && <div className="text-sm text-[var(--good)]">Every key directory has a listing.</div>}
        </div>
      </section>
    </div>
  );
}
