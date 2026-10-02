import { location, view, isLinked } from '@/lib/locations';
import { notFound } from 'next/navigation';
import { locId } from '@/lib/ids';
import ConfigForm from '@/components/ConfigForm';
import ReportActions from '@/components/ReportActions';
import DeleteLocation from '@/components/DeleteLocation';
import { agency } from '@/lib/agency';

export const dynamic = 'force-dynamic';

export default async function ConfigPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = location(locId(id));
  if (!l) notFound();
  const v = view(l);
  const a = agency();
  const form = <ConfigForm l={{
    id: l.id, brand_voice: l.brand_voice ?? '', offered_services: v.offeredServices, service_areas: v.serviceAreas,
    site_slug: l.site_slug ?? '', site_colour: l.site_colour ?? '', auto_reply: Boolean(l.auto_reply), auto_post: Boolean(l.auto_post),
    post_weekday: l.post_weekday, post_hour: l.post_hour, scheduled: Boolean(l.next_post_at), profileServices: v.serviceNames, town: v.town,
    photo_every_days: l.photo_every_days,
    manual: isLinked(l) ? null : {
      title: l.title, street: (v.address.addressLines ?? []).join(', '), town: v.town, county: v.address.administrativeArea ?? '',
      postcode: v.address.postalCode ?? '', phone: l.phone ?? '', website: l.website ?? '', category: v.primaryCategory?.displayName ?? '',
    },
  }} />;

  return (
    <div className="flex flex-col gap-12 pb-16">
      {form}
      <section aria-labelledby="admin-h" className="max-w-[900px] flex flex-col gap-4">
        <div>
          <h2 id="admin-h" className="text-xl font-semibold">Reports and records</h2>
          <p className="text-sm muted mt-1.5 max-w-prose">Send this business and its latest report to GoHighLevel, or take it out of the app.</p>
        </div>
        <div className="panel p-5 flex items-center justify-between gap-4 flex-wrap">
          <div className="text-sm">
            <div className="font-medium">Send to GoHighLevel</div>
            <p className="muted mt-0.5 max-w-prose">Creates or updates the contact, uploads the report and adds a note.</p>
          </div>
          <ReportActions id={l.id} reportUrl={l.report_url} pushedAt={l.ghl_pushed_at} ghlReady={Boolean(a.ghl_token && a.ghl_location_id)} show="ghl" />
        </div>
        <div className="panel p-5 flex items-center justify-between gap-4 flex-wrap" style={{ borderColor: 'var(--bad-line)' }}>
          <div className="text-sm">
            <div className="font-medium">Remove from the app</div>
            <p className="muted mt-0.5 max-w-prose">
              {isLinked(l)
                ? 'Deletes the audits, drafts and pages kept here. The Google profile itself is untouched, and syncing brings it back.'
                : 'Deletes this business and everything stored with it.'}
            </p>
          </div>
          <DeleteLocation id={l.id} linked={isLinked(l)} />
        </div>
      </section>
    </div>
  );
}
