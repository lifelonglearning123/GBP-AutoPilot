'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { callAction } from './Action';
import type { Listing } from '@/lib/public';

const EMPTY = { title: '', street: '', town: '', county: '', postcode: '', phone: '', website: '', category: '' };
type F = typeof EMPTY;
const LABEL: Record<keyof F, string> = { title: 'Business name', street: 'Street address', town: 'Town', county: 'County', postcode: 'Postcode', phone: 'Phone', website: 'Website', category: 'Primary category (e.g. Electrician)' };

/**
 * Add a business to audit. Pasting its Google link is the main route: every detail then comes from
 * Google, so nothing typed from memory can become the (wrong) reference. Typing is the fallback for
 * businesses with no Google profile.
 */
export default function AddBusiness() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'link' | 'hand'>('link');
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<{ listing: Listing; exact: boolean } | null>(null);
  const [f, setF] = useState<F>(EMPTY);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const router = useRouter();

  const go = (id: string) => { setOpen(false); setPreview(null); setUrl(''); setF(EMPTY); router.push(`/locations/${encodeURIComponent(id)}/citations`); router.refresh(); };

  async function lookup() {
    setBusy('lookup'); setMsg(''); setPreview(null);
    try { setPreview(await callAction('public.lookup', { url })); } catch (e: any) { setMsg(e.message); } finally { setBusy(''); }
  }
  async function create() {
    setBusy('create'); setMsg('');
    try { go((await callAction<{ id: string }>('public.create', { cid: preview!.listing.cid })).id); } catch (e: any) { setMsg(e.message); } finally { setBusy(''); }
  }
  async function saveHand() {
    setBusy('hand'); setMsg('');
    try { go((await callAction<{ id: string }>('location.manual.save', { input: f })).id); } catch (e: any) { setMsg(e.message); } finally { setBusy(''); }
  }

  if (!open) return <button className="btn" onClick={() => setOpen(true)}>Add a business</button>;
  const L = preview?.listing;

  return (
    <div className="panel p-4 w-[600px] flex flex-col gap-3 text-left">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          <button className={`tab ${mode === 'link' ? 'active' : ''}`} onClick={() => setMode('link')}>Paste Google link</button>
          <button className={`tab ${mode === 'hand' ? 'active' : ''}`} onClick={() => setMode('hand')}>Enter by hand</button>
        </div>
        <button className="btn sm" onClick={() => setOpen(false)}>Close</button>
      </div>

      {mode === 'link' ? (
        <>
          <div className="text-xs muted">
            Open the business in Google Maps and copy the address bar, or use Share in the Google Maps app. Name, address, phone, categories, hours and reviews all come from Google.
            {' '}<a href="/help#which-link" target="_blank" rel="noopener" className="underline">Which link should I use?</a>
          </div>
          <div className="flex gap-2">
            <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.google.com/maps/place/… or https://maps.app.goo.gl/…" onKeyDown={e => { if (e.key === 'Enter' && url.trim()) lookup(); }} />
            <button className="btn primary" onClick={lookup} disabled={!url.trim() || Boolean(busy)}>{busy === 'lookup' ? 'Reading…' : 'Look up'}</button>
          </div>
          {L && (
            <div className="panel-2 p-3 flex flex-col gap-1 text-sm">
              <div className="flex justify-between gap-3"><strong>{L.title}</strong><span className="text-xs muted">{L.rating ? `${L.rating}★ from ${L.ratingCount} reviews` : 'no reviews'}</span></div>
              <div className="muted">{L.address}</div>
              <div className="muted">{[L.phone, L.website].filter(Boolean).join(' · ')}</div>
              <div className="text-xs muted">{L.categories.join(', ')}</div>
              {!preview!.exact && <div className="text-xs" style={{ color: 'var(--warn)' }}>Matched by name from the link. Check this is the right business before adding. <a href="/help#share-wrong" target="_blank" rel="noopener" className="underline">Why?</a></div>}
              <div className="flex gap-2 mt-2">
                <button className="btn primary" onClick={create} disabled={Boolean(busy)}>{busy === 'create' ? 'Adding and reading reviews…' : 'Add this business'}</button>
                <a className="btn" href={L.mapsUrl} target="_blank" rel="noopener">Open in Maps</a>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="text-xs muted">For businesses with no Google profile, or when you have no link. If a matching Google listing is found it is linked automatically and its details take over; anything you typed that differs is flagged.</div>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(EMPTY) as (keyof F)[]).map(k => (
              <div key={k} className={k === 'title' || k === 'street' || k === 'category' ? 'col-span-2' : ''}>
                <label className="field">{LABEL[k]}</label>
                <input type="text" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} />
              </div>
            ))}
          </div>
          <div><button className="btn primary" onClick={saveHand} disabled={Boolean(busy) || !f.title}>{busy === 'hand' ? 'Saving…' : 'Save and audit'}</button></div>
        </>
      )}
      {msg && <div className="text-xs" style={{ color: 'var(--bad)' }}>{msg}</div>}
    </div>
  );
}
