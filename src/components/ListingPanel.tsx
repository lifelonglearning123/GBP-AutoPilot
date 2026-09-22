'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { callAction } from './Action';
import type { Snapshot, Candidate } from '@/lib/public';

type Diff = { field: string; entered: string; google: string };

/**
 * For hand-added businesses: which public Google listing this is, how fresh the data is, and
 * where what was typed in disagrees with Google. Link by pasting a URL or picking a search match.
 */
export default function ListingPanel({ id, snap, diffs, syncedAt, hasSerper }: { id: string; snap: Snapshot | null; diffs: Diff[]; syncedAt: string | null; hasSerper: boolean }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [changing, setChanging] = useState(false);
  const router = useRouter();

  async function act(name: string, action: string, params: Record<string, unknown>) {
    setBusy(name); setErr('');
    try { const r = await callAction(action, params); router.refresh(); return r; }
    catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  }
  async function linkUrl() { const r = await act('link', 'public.link', { id, url }); if (r) { setUrl(''); setChanging(false); setCands(null); } }
  async function pick(cid: string) { const r = await act('pick', 'public.link', { id, cid }); if (r) { setCands(null); setChanging(false); } }
  async function search() { const r = await act('search', 'public.candidates', { id }); if (r) setCands(r as Candidate[]); }

  const L = snap?.listing;
  const linker = (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="Paste the Google Maps link for this business" />
        <button className="btn primary" onClick={linkUrl} disabled={!url.trim() || Boolean(busy)}>{busy === 'link' ? 'Reading…' : 'Link'}</button>
        <button className="btn" onClick={search} disabled={Boolean(busy)}>{busy === 'search' ? 'Searching…' : 'Find on Google'}</button>
      </div>
      <div className="text-xs muted">Use a Google Maps link (<code>google.com/maps/place/</code> or <code>maps.app.goo.gl/</code>) for an exact match. <a href="/help#which-link" target="_blank" rel="noopener" className="underline">Which link should I use?</a></div>
      {cands && (
        <div className="flex flex-col gap-1">
          {cands.length === 0 && <div className="text-xs muted">No matches. Paste the link instead.</div>}
          {cands.map(c => (
            <button key={c.cid} className="panel-2 px-3 py-2 text-left text-sm flex justify-between gap-3 hover:border-[#303947]" onClick={() => pick(c.cid)} disabled={Boolean(busy)}>
              <span><strong>{c.title}</strong> <span className="muted">· {c.address}{c.phone ? ` · ${c.phone}` : ''}</span></span>
              <span className="text-xs muted whitespace-nowrap">{c.rating ? `${c.rating}★ (${c.ratingCount})` : 'no reviews'} · {c.reasons.join(', ') || 'weak match'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="panel p-4 flex flex-col gap-3">
      {!hasSerper ? (
        <div className="text-sm" style={{ color: 'var(--warn)' }}>Added by hand. Set SERPER_API_KEY to read its public Google listing; until then only typed details and citations can be checked.</div>
      ) : L ? (
        <>
          <div className="flex items-start justify-between gap-4">
            <div className="text-sm">
              <div className="text-xs muted uppercase tracking-wide mb-1">Public Google listing</div>
              <div><strong>{L.title}</strong> · {L.address}{L.phone ? ` · ${L.phone}` : ''}</div>
              <div className="text-xs muted mt-1">
                {L.rating ? `${L.rating}★ from ${L.ratingCount} reviews` : 'No reviews'} · {L.categories.length} categories
                {L.hours ? ' · hours set' : ' · no hours'}
                {' · '}<a href={L.mapsUrl} target="_blank" rel="noopener" className="underline">open in Maps</a>
                {syncedAt && <> · read {syncedAt.slice(0, 16)}</>}
                {snap?.matchedBy === 'search' && <> · <span style={{ color: 'var(--warn)' }}>matched by search, check it is the right business</span></>}
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn sm" onClick={() => act('refresh', 'public.refresh', { id })} disabled={Boolean(busy)}>{busy === 'refresh' ? 'Reading…' : 'Refresh'}</button>
              <button className="btn sm" onClick={() => setChanging(!changing)}>{changing ? 'Cancel' : 'Wrong business?'}</button>
            </div>
          </div>
          {changing && linker}
          {diffs.length > 0 && (
            <div className="panel-2 px-3 py-2 text-sm">
              <div className="font-medium mb-1" style={{ color: 'var(--warn)' }}>What was typed in differs from Google</div>
              <ul className="text-xs flex flex-col gap-0.5">
                {diffs.map(d => <li key={d.field}><strong>{d.field}:</strong> entered <span className="muted">{d.entered}</span>, Google shows <span className="text-[var(--text)]">{d.google}</span></li>)}
              </ul>
              <div className="text-xs muted mt-1">The audit now uses Google's details. If the business considers the entered value correct, the fix is to update the Google profile.</div>
            </div>
          )}
          <div className="text-xs muted">Added by hand: nothing is written to Google (reviews, posts, profile edits) until the profile is connected through the API.</div>
        </>
      ) : (
        <>
          <div className="text-sm"><strong>Not linked to a Google listing yet.</strong> <span className="muted">Link it so the audit can see categories, hours, reviews and verification instead of marking them "not checked".</span></div>
          {linker}
        </>
      )}
      {err && <div className="text-xs" style={{ color: 'var(--bad)' }}>{err}</div>}
    </div>
  );
}
