import { location, view, isLinked } from '@/lib/locations';
import { locId } from '@/lib/ids';
import ConfigForm from '@/components/ConfigForm';

export const dynamic = 'force-dynamic';

export default async function ConfigPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = location(locId(id))!;
  const v = view(l);
  return <ConfigForm l={{
    id: l.id, brand_voice: l.brand_voice ?? '', offered_services: v.offeredServices, service_areas: v.serviceAreas,
    site_slug: l.site_slug ?? '', site_colour: l.site_colour ?? '', auto_reply: Boolean(l.auto_reply), auto_post: Boolean(l.auto_post),
    post_weekday: l.post_weekday, post_hour: l.post_hour, scheduled: Boolean(l.next_post_at), profileServices: v.serviceNames, town: v.town,
    photo_every_days: l.photo_every_days,
    manual: isLinked(l) ? null : {
      title: l.title, street: (v.address.addressLines ?? []).join(', '), town: v.town, county: v.address.administrativeArea ?? '',
      postcode: v.address.postalCode ?? '', phone: l.phone ?? '', website: l.website ?? '', category: v.primaryCategory?.displayName ?? '',
    },
  }} />;
}
