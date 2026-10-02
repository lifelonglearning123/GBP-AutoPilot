import fs from 'node:fs';
import path from 'node:path';
import { all, one, run, parse, log } from './db';
import { json as llmJson } from './llm';
import { location, slugify, view, type LocationView } from './locations';

/**
 * Service × location page generator (rules 4, 7, 8): one page per service, per area, and per
 * service-in-area, each with LocalBusiness + Service + FAQ schema, a Get Directions button and
 * internal links across the matrix. Output is a static folder that can be dropped on any host.
 */
export type PageContent = {
  title: string; metaDescription: string; h1: string; intro: string;
  sections: { heading: string; body: string }[];
  faqs: { q: string; a: string }[];
  cta: string;
};
export type PageRow = {
  id: number; location_id: string; kind: 'home' | 'service' | 'area' | 'service_area' | 'contact';
  slug: string; service: string | null; area: string | null; title: string; content_json: string; created_at: string;
};

export function pages(locationId: string): PageRow[] {
  return all<PageRow>('SELECT * FROM site_pages WHERE location_id = ? ORDER BY kind, slug', locationId);
}
export function page(locationId: string, slug: string): PageRow | undefined {
  return one<PageRow>('SELECT * FROM site_pages WHERE location_id = ? AND slug = ?', locationId, slug);
}

type Spec = { kind: PageRow['kind']; slug: string; service?: string; area?: string };

/** The page matrix for a location. Service×area pages are capped so a 12×10 business is not 120 LLM calls. */
export function matrix(v: LocationView, maxCombos = 40): Spec[] {
  const services = v.offeredServices.length ? v.offeredServices : v.serviceNames.slice(0, 8);
  const areas = v.serviceAreas.length ? v.serviceAreas : (v.town ? [v.town] : []);
  const specs: Spec[] = [{ kind: 'home', slug: 'index' }, { kind: 'contact', slug: 'contact' }];
  for (const s of services) specs.push({ kind: 'service', slug: `services/${slugify(s)}`, service: s });
  for (const a of areas) specs.push({ kind: 'area', slug: `areas/${slugify(a)}`, area: a });
  let combos = 0;
  for (const s of services) for (const a of areas) {
    if (combos++ >= maxCombos) break;
    if (a === v.town && areas.length === 1) continue; // the service page already covers the home town
    specs.push({ kind: 'service_area', slug: `${slugify(s)}-${slugify(a)}`, service: s, area: a });
  }
  return specs;
}

function context(v: LocationView): string {
  return [
    `Business: ${v.title} (${v.primaryCategory?.displayName ?? 'local business'})`,
    `Based in: ${v.town}; address: ${v.addressLine}`,
    `Phone: ${v.phone ?? 'n/a'}; website: ${v.website ?? 'n/a'}`,
    `Services: ${(v.offeredServices.length ? v.offeredServices : v.serviceNames).join(', ')}`,
    `Areas served: ${v.serviceAreas.join(', ') || v.town}`,
    `Description: ${v.description || '(none)'}`,
    `Brand voice: ${v.brand_voice || 'plain, confident, helpful British English'}`,
  ].join('\n');
}

async function writePage(v: LocationView, spec: Spec, reviews: { rating: number; comment: string }[]): Promise<PageContent> {
  const what = {
    home: 'the HOME page: what the business does, where, why choose them, overview of services and areas',
    contact: 'the CONTACT page: how to get in touch, opening hours, directions, what happens after you call',
    service: `the SERVICE page for "${spec.service}" in and around ${v.town}: who it is for, what is included, process, pricing guidance in general terms, why this business`,
    area: `the AREA page for ${spec.area}: all services offered there, local knowledge (landmarks, housing types, typical jobs), response times`,
    service_area: `the page for "${spec.service}" in ${spec.area}: specific to that service in that town, local detail, why they are the right choice there. Must be materially different from the generic service page, not a find-and-replace of the town name`,
  }[spec.kind];

  const system = `You write pages for a local business website that must rank in Google's local pack and organic results.
Write ${what}.
Rules:
- British English. Specific, concrete, no fluff, no "in today's fast-paced world". Sound like the owner explaining, not an agency.
- Use the service and the town name naturally in the title, h1, intro and one heading. Never stuff keywords or list towns.
- Each page must contain genuinely different information from sibling pages (doorway pages get filtered). Add local detail where the page is area-specific.
- 350 to 700 words of body across intro and sections. 3 to 5 sections. 3 to 5 FAQs with real answers.
- title: under 60 characters, ends with " | ${v.title}". metaDescription: 140 to 155 characters with a benefit and the town.
Return JSON: { "title", "metaDescription", "h1", "intro", "sections": [{"heading","body"}], "faqs": [{"q","a"}], "cta" }`;
  const user = `${context(v)}\n\nReal customer reviews to draw themes from (do not quote names):\n${reviews.map(r => `- ${r.rating}★ ${r.comment}`).join('\n') || '(none)'}`;
  const out = await llmJson<PageContent>(system, user);
  return {
    title: String(out.title ?? v.title), metaDescription: String(out.metaDescription ?? ''), h1: String(out.h1 ?? v.title),
    intro: String(out.intro ?? ''), sections: Array.isArray(out.sections) ? out.sections : [], faqs: Array.isArray(out.faqs) ? out.faqs : [],
    cta: String(out.cta ?? 'Get in touch'),
  };
}

/** Generate (or regenerate) every page in the matrix. `only` limits to slugs, e.g. after adding one area. */
export async function generate(locationId: string, only?: string[], concurrency = 4): Promise<PageRow[]> {
  const l = location(locationId);
  if (!l) throw new Error('Unknown location');
  const v = view(l);
  const specs = matrix(v).filter(s => !only || only.includes(s.slug));
  const reviews = all<{ rating: number; comment: string }>(
    `SELECT rating, comment FROM reviews WHERE location_id = ? AND rating >= 4 AND comment != '' ORDER BY create_time DESC LIMIT 8`, locationId);

  let i = 0;
  const worker = async () => {
    while (i < specs.length) {
      const spec = specs[i++];
      try {
        const c = await writePage(v, spec, reviews);
        run(
          `INSERT INTO site_pages (location_id, kind, slug, service, area, title, content_json) VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(location_id, slug) DO UPDATE SET kind = excluded.kind, service = excluded.service, area = excluded.area,
             title = excluded.title, content_json = excluded.content_json, created_at = datetime('now')`,
          locationId, spec.kind, spec.slug, spec.service ?? null, spec.area ?? null, c.title, JSON.stringify(c)
        );
      } catch (e: any) {
        log('site', 'error', `${spec.slug}: ${e.message}`, locationId);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, specs.length) }, worker));
  log('site', 'ok', `${specs.length} pages generated`, locationId);
  return pages(locationId);
}

// ---------- rendering ----------

const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const para = (s: string) => String(s ?? '').split(/\n{2,}|\n/).map(t => t.trim()).filter(Boolean).map(t => `<p>${esc(t)}</p>`).join('\n');
const DAY: Record<string, string> = { MONDAY: 'Monday', TUESDAY: 'Tuesday', WEDNESDAY: 'Wednesday', THURSDAY: 'Thursday', FRIDAY: 'Friday', SATURDAY: 'Saturday', SUNDAY: 'Sunday' };
const hhmm = (t: any) => `${String(t?.hours ?? 0).padStart(2, '0')}:${String(t?.minutes ?? 0).padStart(2, '0')}`;

function href(fromSlug: string, toSlug: string): string {
  const depth = fromSlug.split('/').length - 1;
  const up = depth ? '../'.repeat(depth) : '';
  return up + (toSlug === 'index' ? 'index.html' : `${toSlug}.html`);
}

export function directionsUrl(v: LocationView): string {
  const dest = encodeURIComponent(`${v.title}, ${v.addressLine}`);
  return v.place_id
    ? `https://www.google.com/maps/dir/?api=1&destination=${dest}&destination_place_id=${encodeURIComponent(v.place_id)}`
    : `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
}

export function schemaFor(v: LocationView, p: PageRow, c: PageContent, baseUrl: string) {
  const rating = one<{ n: number; avg: number }>(`SELECT COUNT(*) AS n, AVG(rating) AS avg FROM reviews WHERE location_id = ? AND rating > 0`, v.id);
  const openingHours = v.hoursPeriods.map((x: any) => ({
    '@type': 'OpeningHoursSpecification', dayOfWeek: DAY[x.openDay] ?? x.openDay, opens: hhmm(x.openTime), closes: hhmm(x.closeTime),
  }));
  const services = v.offeredServices.length ? v.offeredServices : v.serviceNames;
  const business: any = {
    '@type': 'LocalBusiness', '@id': `${baseUrl}/#business`, name: v.title, url: baseUrl, telephone: v.phone ?? undefined,
    description: v.description ?? undefined,
    address: { '@type': 'PostalAddress', streetAddress: (v.address.addressLines ?? []).join(', '), addressLocality: v.address.locality, addressRegion: v.address.administrativeArea, postalCode: v.address.postalCode, addressCountry: v.address.regionCode ?? 'GB' },
    geo: v.latlng?.latitude ? { '@type': 'GeoCoordinates', latitude: v.latlng.latitude, longitude: v.latlng.longitude } : undefined,
    hasMap: v.maps_uri ?? undefined,
    openingHoursSpecification: openingHours.length ? openingHours : undefined,
    areaServed: (v.serviceAreas.length ? v.serviceAreas : [v.town]).filter(Boolean).map(a => ({ '@type': 'City', name: a })),
    makesOffer: services.map(s => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: s } })),
    aggregateRating: rating?.n ? { '@type': 'AggregateRating', ratingValue: Number(rating.avg.toFixed(1)), reviewCount: rating.n } : undefined,
  };
  const graph: any[] = [business];
  if (p.service) {
    graph.push({ '@type': 'Service', name: p.service, serviceType: p.service, provider: { '@id': `${baseUrl}/#business` },
      areaServed: p.area ? { '@type': 'City', name: p.area } : business.areaServed, description: c.metaDescription });
  }
  if (c.faqs.length) {
    graph.push({ '@type': 'FAQPage', mainEntity: c.faqs.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) });
  }
  const crumbs = [{ name: 'Home', slug: 'index' }];
  if (p.kind === 'service_area' && p.service) crumbs.push({ name: p.service, slug: `services/${slugify(p.service)}` });
  if (p.slug !== 'index') crumbs.push({ name: c.h1, slug: p.slug });
  graph.push({ '@type': 'BreadcrumbList', itemListElement: crumbs.map((x, i) => ({ '@type': 'ListItem', position: i + 1, name: x.name, item: `${baseUrl}/${x.slug === 'index' ? '' : x.slug + '.html'}` })) });
  return { '@context': 'https://schema.org', '@graph': graph };
}

export function render(v: LocationView, p: PageRow, allPages: PageRow[], baseUrl: string): string {
  const c = parse<PageContent>(p.content_json, { title: p.title, metaDescription: '', h1: p.title, intro: '', sections: [], faqs: [], cta: '' });
  const services = allPages.filter(x => x.kind === 'service');
  const areas = allPages.filter(x => x.kind === 'area');
  const combos = allPages.filter(x => x.kind === 'service_area');
  const related = p.kind === 'service' ? combos.filter(x => x.service === p.service)
    : p.kind === 'area' ? combos.filter(x => x.area === p.area)
    : p.kind === 'service_area' ? combos.filter(x => x.service === p.service && x.slug !== p.slug).slice(0, 6)
    : [];
  const colour = v.site_colour || '#1f5f8b';
  const hours = v.hoursPeriods.map((x: any) => `<li><span>${DAY[x.openDay] ?? x.openDay}</span><span>${hhmm(x.openTime)} – ${hhmm(x.closeTime)}</span></li>`).join('');
  const tel = v.phone ? v.phone.replace(/\s+/g, '') : '';
  const link = (x: PageRow, label?: string) => `<a href="${href(p.slug, x.slug)}">${esc(label ?? x.title.replace(/\s*\|.*$/, ''))}</a>`;
  const canonical = `${baseUrl}/${p.slug === 'index' ? '' : p.slug + '.html'}`;

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(c.title)}</title>
<meta name="description" content="${esc(c.metaDescription)}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="stylesheet" href="${href(p.slug, 'styles').replace(/\.html$/, '.css')}">
<style>:root{--brand:${colour}}</style>
<script type="application/ld+json">${JSON.stringify(schemaFor(v, p, c, baseUrl))}</script>
</head>
<body>
<header class="top">
  <a class="brand" href="${href(p.slug, 'index')}">${esc(v.title)}</a>
  <nav>
    ${services.slice(0, 6).map(s => link(s, s.service ?? undefined)).join('')}
    ${link({ slug: 'contact', title: 'Contact' } as PageRow, 'Contact')}
    ${tel ? `<a class="btn" href="tel:${esc(tel)}">Call ${esc(v.phone!)}</a>` : ''}
  </nav>
</header>
<main>
  <section class="hero">
    <h1>${esc(c.h1)}</h1>
    ${para(c.intro)}
    <p class="actions">
      ${tel ? `<a class="btn" href="tel:${esc(tel)}">Call ${esc(v.phone!)}</a>` : ''}
      <a class="btn outline" href="${esc(directionsUrl(v))}" target="_blank" rel="noopener">Get directions</a>
    </p>
  </section>
  ${c.sections.map(s => `<section><h2>${esc(s.heading)}</h2>${para(s.body)}</section>`).join('\n')}
  ${c.faqs.length ? `<section class="faq"><h2>Frequently asked questions</h2>${c.faqs.map(f => `<details><summary>${esc(f.q)}</summary>${para(f.a)}</details>`).join('')}</section>` : ''}
  ${related.length ? `<section class="related"><h2>${p.kind === 'area' ? `Services in ${esc(p.area!)}` : `${esc(p.service!)} nearby`}</h2><ul>${related.map(x => `<li>${link(x)}</li>`).join('')}</ul></section>` : ''}
  ${p.kind === 'home' ? `<section class="grid"><div><h2>Services</h2><ul>${services.map(x => `<li>${link(x, x.service!)}</li>`).join('')}</ul></div><div><h2>Areas we cover</h2><ul>${areas.map(x => `<li>${link(x, x.area!)}</li>`).join('')}</ul></div></section>` : ''}
  <section class="cta">
    <h2>${esc(c.cta || 'Get in touch')}</h2>
    <p class="actions">
      ${tel ? `<a class="btn" href="tel:${esc(tel)}">Call ${esc(v.phone!)}</a>` : ''}
      <a class="btn outline" href="${esc(directionsUrl(v))}" target="_blank" rel="noopener">Get directions</a>
      ${v.new_review_uri ? `<a class="btn outline" href="${esc(v.new_review_uri)}" target="_blank" rel="noopener">Leave a review</a>` : ''}
    </p>
  </section>
</main>
<footer>
  <div>
    <strong>${esc(v.title)}</strong><br>${esc(v.addressLine)}${v.phone ? `<br><a href="tel:${esc(tel)}">${esc(v.phone)}</a>` : ''}
    ${v.maps_uri ? `<br><a href="${esc(v.maps_uri)}" target="_blank" rel="noopener">View on Google Maps</a>` : ''}
  </div>
  ${hours ? `<div><strong>Opening hours</strong><ul class="hours">${hours}</ul></div>` : ''}
  <div><strong>Areas</strong><ul>${areas.map(x => `<li>${link(x, x.area!)}</li>`).join('')}</ul></div>
</footer>
</body>
</html>`;
}

export const STYLES = `*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1c2430;line-height:1.6;background:#fff}
a{color:var(--brand)}main{max-width:860px;margin:0 auto;padding:0 20px 48px}header.top{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #e6eaf0}
.brand{font-weight:700;font-size:1.15rem;text-decoration:none;color:#1c2430}nav{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center}nav a{text-decoration:none;font-size:.95rem}
.btn{display:inline-block;background:var(--brand);color:#fff!important;padding:.6rem 1.1rem;border-radius:8px;text-decoration:none;font-weight:600}.btn.outline{background:#fff;color:var(--brand)!important;border:2px solid var(--brand)}
.hero{padding:40px 0 16px}h1{font-size:2rem;line-height:1.2;margin:0 0 12px}h2{font-size:1.35rem;margin:32px 0 8px}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
details{border:1px solid #e6eaf0;border-radius:8px;padding:10px 14px;margin:8px 0}summary{cursor:pointer;font-weight:600}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}@media(max-width:600px){.grid{grid-template-columns:1fr}}
.cta{background:#f4f7fb;border-radius:12px;padding:24px;margin-top:40px}footer{border-top:1px solid #e6eaf0;padding:28px 20px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px;font-size:.95rem;max-width:860px;margin:0 auto}
footer ul{list-style:none;padding:0;margin:6px 0 0}.hours li{display:flex;justify-content:space-between;gap:12px}`;

/**
 * Write the whole site to output/sites/<slug>/ and return what was written.
 *
 * The folder is emptied first, so it must be the site's own and nothing else's. Sites used to be
 * built straight into output/<name>, with the name taken as typed in Settings: a folder name of
 * "reports" emptied output/reports, which is every client's report. They now have a parent of
 * their own, the name is always a slug, and the delete refuses any path that is not directly
 * inside that parent.
 */
export function build(locationId: string, baseUrlOverride?: string): { dir: string; files: string[]; baseUrl: string } {
  const l = location(locationId);
  if (!l) throw new Error('Unknown location');
  const v = view(l);
  const ps = pages(locationId);
  if (!ps.length) throw new Error('No pages generated yet');
  const slug = slugify(v.site_slug || v.title);
  const baseUrl = (baseUrlOverride || v.website || `https://${slug}.example`).replace(/\/+$/, '');
  const parent = path.join(process.cwd(), 'output', 'sites');
  const dir = path.join(parent, slug);
  if (path.dirname(path.resolve(dir)) !== path.resolve(parent)) throw new Error('That folder name cannot be used for a website.');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  for (const p of ps) {
    const file = path.join(dir, `${p.slug}.html`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, render(v, p, ps, baseUrl), 'utf8');
    files.push(`${p.slug}.html`);
  }
  fs.writeFileSync(path.join(dir, 'styles.css'), STYLES, 'utf8');
  const urls = ps.map(p => `  <url><loc>${baseUrl}/${p.slug === 'index' ? '' : p.slug + '.html'}</loc><lastmod>${p.created_at.slice(0, 10)}</lastmod></url>`).join('\n');
  fs.writeFileSync(path.join(dir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml\n`, 'utf8');
  files.push('styles.css', 'sitemap.xml', 'robots.txt');
  log('site', 'ok', `built ${files.length} files to ${dir}`, locationId);
  return { dir, files, baseUrl };
}

/** Render one page on the fly for the in-app preview (links are rewritten to the preview route). */
export function preview(locationId: string, slug: string): string {
  const l = location(locationId);
  if (!l) throw new Error('Unknown location');
  const v = view(l);
  const ps = pages(locationId);
  const p = ps.find(x => x.slug === slug);
  if (!p) throw new Error('Page not found');
  const base = `/api/site/${encodeURIComponent(locationId)}/preview`;
  const html = render(v, p, ps, 'https://preview.local');
  // Absolute preview links: resolve every relative href against the page's own preview URL.
  const depth = slug.split('/').length - 1;
  return html.replace(/href="((?:\.\.\/)*)([^"#:]+?)\.(html|css)"/g, (_m, ups: string, rest: string, ext: string) => {
    const upCount = (ups.match(/\.\.\//g) ?? []).length;
    const parts = slug.split('/').slice(0, Math.max(0, depth - upCount));
    const target = [...parts, rest].join('/');
    return ext === 'css' ? `href="${base}/styles.css"` : `href="${base}/${target}"`;
  });
}
