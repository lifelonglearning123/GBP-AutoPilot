import { location, view } from '@/lib/locations';
import { matrix, pages } from '@/lib/site';
import { locId } from '@/lib/ids';
import SitePanel from '@/components/SitePanel';

export const dynamic = 'force-dynamic';

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = location(locId(id))!;
  const v = view(l);
  const specs = matrix(v);
  const existing = pages(l.id);
  const byKind = (k: string) => existing.filter(p => p.kind === k).length;

  return (
    <SitePanel
      locationId={l.id}
      website={v.website ?? ''}
      ready={v.offeredServices.length > 0 && (v.serviceAreas.length > 0 || Boolean(v.town))}
      planned={{ total: specs.length, services: specs.filter(s => s.kind === 'service').length, areas: specs.filter(s => s.kind === 'area').length, combos: specs.filter(s => s.kind === 'service_area').length }}
      existing={{ total: existing.length, services: byKind('service'), areas: byKind('area'), combos: byKind('service_area') }}
      pages={existing.map(p => ({ slug: p.slug, kind: p.kind, title: p.title, created_at: p.created_at }))}
    />
  );
}
