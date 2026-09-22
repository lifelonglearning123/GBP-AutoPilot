'use client';
import { useState } from 'react';
import Link from 'next/link';
import Action from './Action';

type Counts = { total: number; services: number; areas: number; combos: number };
type Props = {
  locationId: string; website: string; ready: boolean; planned: Counts; existing: Counts;
  pages: { slug: string; kind: string; title: string; created_at: string }[];
};

export default function SitePanel({ locationId, website, ready, planned, existing, pages }: Props) {
  const [baseUrl, setBaseUrl] = useState(website);
  const [built, setBuilt] = useState<{ dir: string; files: string[] } | null>(null);
  const preview = (slug: string) => `/api/site/${encodeURIComponent(locationId)}/preview/${slug}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <section className="panel p-5 flex flex-col gap-3">
          <h2 className="font-semibold">1. Generate pages</h2>
          <p className="text-sm muted">
            Home, contact, {planned.services} service pages, {planned.areas} area pages and {planned.combos} service × area pages
            ({planned.total} total). Each page gets LocalBusiness, Service, FAQ and breadcrumb schema plus a Get Directions button.
          </p>
          {!ready && <div className="text-sm" style={{ color: 'var(--warn)' }}>Add services and areas on the Configure tab first.</div>}
          <div>
            <Action action="site.generate" params={{ id: locationId }} className="btn primary" busy={`Writing ${planned.total} pages… (about ${Math.ceil(planned.total / 4) * 20}s)`} disabled={!ready}
              confirm={existing.total ? 'Regenerate every page? Existing content will be replaced.' : undefined}>
              {existing.total ? 'Regenerate all pages' : 'Generate pages'}
            </Action>
          </div>
        </section>

        <section className="panel p-5 flex flex-col gap-3">
          <h2 className="font-semibold">2. Build the static site</h2>
          <label className="field">Live URL (for canonical tags, schema and sitemap)</label>
          <input type="url" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://www.example.co.uk" />
          <div className="flex items-center gap-3">
            <Action action="site.build" params={{ id: locationId, baseUrl }} busy="Building…" disabled={!existing.total} onDone={setBuilt}>Build to output folder</Action>
            {built && <span className="text-xs muted">{built.files.length} files → <code>{built.dir}</code></span>}
          </div>
          <p className="text-xs muted">Drop the folder on any static host (Vercel, Netlify, cPanel). For an existing site, copy the pages in and keep the internal link paths.</p>
        </section>
      </div>

      {pages.length > 0 && (
        <section className="panel p-5">
          <h2 className="font-semibold mb-3">Pages ({pages.length})</h2>
          <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
            {pages.map(p => (
              <Link key={p.slug} href={preview(p.slug)} target="_blank" className="panel-2 px-3 py-2 text-sm flex justify-between gap-2 hover:border-[#303947]">
                <span className="truncate">{p.title.replace(/\s*\|.*$/, '')}</span>
                <span className="pill">{p.kind.replace('_', ' × ')}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
