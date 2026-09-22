import { notFound } from 'next/navigation';
import { location, view, isLinked } from '@/lib/locations';
import { audit, LOW_COVERAGE } from '@/lib/audit';
import { locId, locParam } from '@/lib/ids';
import Tabs from '@/components/Tabs';
import Action from '@/components/Action';
import DeleteLocation from '@/components/DeleteLocation';
import ReportActions from '@/components/ReportActions';
import MetricsStrip from '@/components/MetricsStrip';
import { summary } from '@/lib/extras';
import ListingPanel from '@/components/ListingPanel';
import { snapshot, enteredDiffs } from '@/lib/public';
import { agency } from '@/lib/agency';

export const dynamic = 'force-dynamic';

export default async function LocationLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = location(locId(id));
  if (!l) notFound();
  const v = view(l);
  const { score, coverage } = audit(l);
  const partial = coverage < LOW_COVERAGE;
  const base = `/locations/${locParam(l.id)}`;
  const linked = isLinked(l);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-3">{l.title}{!linked && <span className="pill warn" title="Audited from the public listing. Writing to Google needs the profile connected through the API.">Added by hand · read-only</span>}</h1>
          <div className="text-sm muted mt-1">
            {v.primaryCategory?.displayName ?? 'No category'} · {v.addressLine || 'No address'} · {v.phone ?? 'No phone'}
            {v.maps_uri && <> · <a className="underline" href={v.maps_uri} target="_blank" rel="noopener">Maps</a></>}
            {l.synced_at && <> · synced {l.synced_at.slice(0, 16)}</>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ReportActions id={l.id} reportUrl={l.report_url} pushedAt={l.ghl_pushed_at} ghlReady={Boolean(agency().ghl_token && agency().ghl_location_id)} />
          <div className="text-right">
            <div className={`score text-3xl font-semibold ${partial ? 'muted' : score >= 80 ? 'text-[var(--good)]' : score >= 50 ? 'text-[var(--warn)]' : 'text-[var(--bad)]'}`}>{score}<span className="text-sm muted">/100</span></div>
            {partial && <div className="text-xs muted" title="Link the Google listing to score the rest">only {coverage}% checked</div>}
          </div>
          {linked && <Action action="location.resync" params={{ id: l.id }} busy="Re-reading…">Re-read from Google</Action>}
          <DeleteLocation id={l.id} linked={linked} />
        </div>
      </div>
      {linked && <MetricsStrip id={l.id} items={summary(l.id)} syncedAt={l.metrics_synced_at} />}
      <Tabs base={base} />
      {!linked && <ListingPanel id={l.id} snap={snapshot(l)} diffs={enteredDiffs(l)} syncedAt={l.public_synced_at} hasSerper={Boolean(process.env.SERPER_API_KEY)} />}
      {children}
    </div>
  );
}
