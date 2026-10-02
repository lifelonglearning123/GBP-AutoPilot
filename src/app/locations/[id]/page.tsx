import Link from 'next/link';
import { notFound } from 'next/navigation';
import { location, view, isLinked, recentChanges, phoneEditBlocked } from '@/lib/locations';
import { audit } from '@/lib/audit';
import { suggestions } from '@/lib/suggest';
import { rivalCategories } from '@/lib/keywords';
import { scoreHistory } from '@/lib/history';
import { locId, locParam } from '@/lib/ids';
import Action from '@/components/Action';
import SuggestionCard from '@/components/SuggestionCard';
import ScoreRuler from '@/components/ScoreRuler';
import { verdict, nextSteps, atStake, worth } from '@/lib/steps';
import { weeklyChange, weekLabel } from '@/lib/history';
import { pts } from '@/lib/format';
import { LOW_COVERAGE } from '@/lib/audit';
import NextSteps from '@/components/NextSteps';
import BasicsForm from '@/components/BasicsForm';
import Scorecard from '@/components/Scorecard';

export const dynamic = 'force-dynamic';

const FIELD: Record<string, string> = { description: 'Description', categories: 'Categories', services: 'Services list' };
const when = (t: string) => new Date(t.replace(' ', 'T') + 'Z').toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Overview: how the profile is doing in one line, what to do next (biggest gains first), and the
 * places to do it: business details saved straight to Google, and AI drafts approved one by one.
 * The scoring detail sits behind "Everything we check", so a business owner is not met with an audit.
 */
export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = location(locId(id));
  if (!l) notFound();
  const v = view(l);
  const { items, source, coverage, score } = audit(l);
  const linked = isLinked(l);
  const base = `/locations/${locParam(l.id)}`;
  const pending = suggestions(l.id).filter(s => s.status === 'pending');
  const changes = recentChanges(l.id);
  const phoneLocked = phoneEditBlocked(l.id);
  const isOk = (k: string) => items.find(i => i.key === k)?.ok ?? false;
  const done = { phone: isOk('phone'), website: isOk('website'), categories: isOk('primary_category') && isOk('additional_categories'), hours: isOk('hours') };
  const catDraft = pending.find(s => s.field === 'categories');
  const catDrafts: { name: string; displayName: string }[] = catDraft ? (JSON.parse(catDraft.proposal_json).additional ?? []) : [];
  const categories = {
    primary: v.primaryCategory ? { name: v.primaryCategory.name, displayName: v.primaryCategory.displayName } : null,
    additional: v.additionalCategories.map(c => ({ name: c.name, displayName: c.displayName })),
  };
  const hasContext = v.offeredServices.length > 0 || v.serviceNames.length > 0;
  const note = source === 'api' ? 'Read from the Google profile.'
    : source === 'public' ? `Read from the public Google listing. ${coverage} of the 100 points could be checked; the rest needs owner access.`
    : `No Google listing linked, so only ${coverage} of the 100 points can be checked.`;

  const todo = nextSteps(items);
  const gain = todo.reduce((sum, i) => sum + atStake(i), 0);
  const partial = coverage < LOW_COVERAGE;
  const { word, colour } = verdict(score, partial);
  const week = weeklyChange(l.id);
  const history = scoreHistory(l.id);

  return (
    <div className="flex flex-col gap-12 pb-16 max-w-[900px]">
      <section aria-labelledby="state-h" className="panel-2 p-6 sm:p-7 flex items-start justify-between gap-6 flex-wrap">
        <div className="max-w-prose">
          <h2 id="state-h" className="display text-2xl font-semibold" style={{ color: colour }}>{word}</h2>
          <p className="mt-2">
            {todo.length === 0
              ? 'Everything we check is in place. Keep reviews and posts coming to hold it there.'
              : todo.length === 1
                ? `One thing is worth doing here, and it is worth about ${worth(gain)}.`
                : `${todo.length} things are worth doing here. Together they add up to about ${worth(gain)}.`}
          </p>
          <p className="text-sm muted mt-1.5">
            {partial
              ? `Only ${coverage} of the 100 points can be checked until the Google profile is connected.`
              : week && week.delta !== 0
                ? `${week.delta > 0 ? 'Up' : 'Down'} ${Math.abs(week.delta)} points since the week of ${weekLabel(week.since)}.`
                : history.length > 1 ? 'No change since last week.' : 'A week-by-week trend appears once next week’s score is recorded.'}
          </p>
        </div>
        <div className="text-right">
          <div className="display text-4xl font-semibold score" style={{ color: colour }}>{score}</div>
          <div className="text-sm muted">out of 100</div>
        </div>
      </section>

      <div className="flex flex-col gap-12 min-w-0">
          <NextSteps items={items} base={base} linked={linked} reviewUri={l.new_review_uri} phoneLocked={phoneLocked} />

          <section id="details" aria-labelledby="details-h" className="scroll-mt-24">
            <h2 id="details-h" className="text-xl font-semibold">Your details on Google</h2>
            <p className="text-sm muted mt-1.5 mb-4 max-w-prose">
              {linked
                ? 'What customers see on the profile. Anything you change here is saved straight to Google.'
                : 'What the public Google listing shows. To change any of it from here, the owner needs to add your Google account as a manager.'}
            </p>
            <div className="panel p-5 sm:p-6">
              <BasicsForm id={l.id} linked={linked} name={l.title} address={v.addressLine}
                phone={v.phone} website={v.website} periods={v.hoursPeriods} phoneLocked={phoneLocked}
                categories={categories} catDrafts={catDrafts} done={done}
                rivals={rivalCategories(l)} competitorsHref={`${base}/competitors`} />
            </div>
          </section>

          <section id="ai" aria-labelledby="ai-h" className="scroll-mt-24">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="max-w-xl">
                <h2 id="ai-h" className="text-xl font-semibold">Wording written for you</h2>
                <p className="text-sm muted mt-1.5">
                  A draft description, extra categories from Google’s own list, and a list of services.
                  Edit anything you like: nothing reaches Google until you approve it.
                </p>
              </div>
              <Action action="suggest.generate" params={{ id: l.id }} className="btn primary" busy="Drafting…" disabled={!hasContext || !linked}>
                {pending.length ? 'Write them again' : 'Write drafts for me'}
              </Action>
            </div>
            {!hasContext && (
              <p className="text-sm mt-3" style={{ color: 'var(--warn)' }}>
                First list the services this business offers on the <Link className="underline" href={`${base}/config`}>Settings tab</Link>, so the drafts describe the real business.
              </p>
            )}
            {pending.length > 0 ? (
              <div className="flex flex-col gap-4 mt-5">
                {pending.map(s => (
                  <SuggestionCard key={s.id} s={s} linked={linked} current={{
                    description: v.description ?? '',
                    categories: { primary: v.primaryCategory, additional: v.additionalCategories },
                    services: v.serviceNames,
                  }} />
                ))}
              </div>
            ) : hasContext && (
              <p className="text-sm muted mt-3">No drafts waiting. Draft new ones whenever the business changes what it offers.</p>
            )}
          </section>

          {changes.length > 0 && (
            <section aria-labelledby="changes-h">
              <h2 id="changes-h" className="text-xl font-semibold">Saved to Google recently</h2>
              <ul className="mt-3 border-y divide-y text-sm" style={{ borderColor: 'var(--line)' }}>
                {changes.map((c, i) => {
                  const what = c.job === 'apply' ? `${FIELD[c.detail ?? ''] ?? c.detail} saved` : (c.detail ?? 'Business details');
                  return (
                    <li key={i} className="py-2.5 flex items-baseline justify-between gap-4" style={{ borderColor: 'var(--line-soft)' }}>
                      <span style={c.status === 'error' ? { color: 'var(--bad)' } : undefined}>
                        {c.status === 'error' ? `Not saved: ${c.detail}` : what}
                      </span>
                      <span className="text-xs muted whitespace-nowrap score">{when(c.ran_at)}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
      </div>

      <details className="group panel-2 px-5 sm:px-6 py-4">
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-3">
          <span>
            <span className="font-semibold">Everything we check</span>
            <span className="block text-sm muted mt-0.5">All {items.length} checks and how the 100 points are shared out.</span>
          </span>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="shrink-0 transition-transform duration-200 group-open:rotate-180" style={{ color: 'var(--muted)' }}>
            <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </summary>
        <div className="mt-6 flex flex-col gap-10">
          <ScoreRuler items={items} score={score} coverage={coverage} history={history} />
          <Scorecard items={items} note={note} />
        </div>
      </details>
    </div>
  );
}
