import { notFound } from 'next/navigation';
import { location, view, isLinked } from '@/lib/locations';
import { audit, LOW_COVERAGE } from '@/lib/audit';
import { locId, locParam } from '@/lib/ids';
import Tabs from '@/components/Tabs';
import Action from '@/components/Action';
import ReportActions from '@/components/ReportActions';
import MetricsStrip from '@/components/MetricsStrip';
import { summary } from '@/lib/extras';
import ListingPanel from '@/components/ListingPanel';
import { snapshot, enteredDiffs } from '@/lib/public';
import { verdict } from '@/lib/steps';

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
  const state = verdict(score, partial);
  const where = [v.primaryCategory?.displayName, v.town].filter(Boolean).join(' in ') || v.addressLine || 'No category or address yet';

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-x-6 gap-y-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold flex items-center gap-3 flex-wrap">
            {l.title}
            {!linked && <span className="pill warn" title="Read from the public Google listing. Changing it here needs the profile connected to the app.">Added by hand</span>}
          </h1>
          <p className="text-sm muted mt-1.5">
            {where}
            {v.maps_uri && <> · <a className="underline" href={v.maps_uri} target="_blank" rel="noopener">See it on Google</a></>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm" title={partial ? `Only ${coverage} of the 100 points can be checked` : undefined}>
            <span className="score display text-xl font-semibold" style={{ color: state.colour }}>{score}</span>
            <span className="muted">/100</span>
            <span className="ml-2" style={{ color: state.colour }}>{state.word}</span>
          </span>
          <ReportActions id={l.id} reportUrl={l.report_url} pushedAt={l.ghl_pushed_at} ghlReady={false} show="report" />
          {linked && <Action action="location.resync" params={{ id: l.id }} busy="Re-reading…">Re-read from Google</Action>}
        </div>
      </div>
      {linked && <MetricsStrip id={l.id} items={summary(l.id)} syncedAt={l.metrics_synced_at} />}
      <Tabs base={base} />
      {!linked && <ListingPanel id={l.id} snap={snapshot(l)} diffs={enteredDiffs(l)} syncedAt={l.public_synced_at} hasSerper={Boolean(process.env.SERPER_API_KEY)} />}
      {children}
    </div>
  );
}
