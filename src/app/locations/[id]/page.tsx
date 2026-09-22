import Link from 'next/link';
import { location, view, isLinked, recentChanges, phoneEditBlocked } from '@/lib/locations';
import { audit } from '@/lib/audit';
import { suggestions } from '@/lib/suggest';
import { rivalCategories } from '@/lib/keywords';
import { locId, locParam } from '@/lib/ids';
import Action from '@/components/Action';
import SuggestionCard from '@/components/SuggestionCard';
import ScoreRuler from '@/components/ScoreRuler';
import NextSteps from '@/components/NextSteps';
import BasicsForm from '@/components/BasicsForm';
import Scorecard from '@/components/Scorecard';

export const dynamic = 'force-dynamic';

const FIELD: Record<string, string> = { description: 'Description', categories: 'Categories', services: 'Services list' };
const when = (t: string) => new Date(t.replace(' ', 'T') + 'Z').toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Audit & fill: why the score is what it is, what to do next (biggest gains first), and the places
 * to do it: business details saved straight to Google, and AI drafts approved one by one.
 */
export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = location(locId(id))!;
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

  return (
    <div className="flex flex-col gap-10 pb-16">
      <ScoreRuler items={items} score={score} coverage={coverage} />

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
        <div className="flex flex-col gap-12 min-w-0">
          <NextSteps items={items} base={base} linked={linked} reviewUri={l.new_review_uri} phoneLocked={phoneLocked} />

          <section id="details" aria-labelledby="details-h" className="scroll-mt-24">
            <h2 id="details-h" className="text-lg font-semibold">Business details</h2>
            <p className="text-sm muted mt-1 mb-4">What customers see on the Google profile. Saving updates the live profile.</p>
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
                <h2 id="ai-h" className="text-lg font-semibold">Description, categories and services</h2>
                <p className="text-sm muted mt-1">
                  gpt-5.5 drafts a description, extra categories from Google’s own list, and a list of services.
                  You can edit each draft, and nothing reaches Google until you approve it.
                </p>
              </div>
              <Action action="suggest.generate" params={{ id: l.id }} className="btn primary" busy="Drafting…" disabled={!hasContext || !linked}>
                {pending.length ? 'Draft again' : 'Draft suggestions'}
              </Action>
            </div>
            {!hasContext && (
              <p className="text-sm mt-3" style={{ color: 'var(--warn)' }}>
                First list the services this business offers on the <Link className="underline" href={`${base}/config`}>Configure tab</Link>, so the drafts describe the real business.
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
              <h2 id="changes-h" className="text-lg font-semibold">Saved to Google recently</h2>
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

        <aside className="lg:sticky lg:top-6">
          <Scorecard items={items} note={note} />
        </aside>
      </div>
    </div>
  );
}
