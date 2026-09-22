'use client';
import { useState } from 'react';
import Action from './Action';
import type { PhotoRow } from '@/lib/extras';

const CATS = ['ADDITIONAL', 'AT_WORK', 'EXTERIOR', 'INTERIOR', 'TEAMS', 'PRODUCT'];

/** A queue of photos released on a cadence: fresh photos are a freshness signal like posts. */
export default function PhotoQueue({ locationId, items, everyDays, nextAt }: { locationId: string; items: PhotoRow[]; everyDays: number; nextAt: string | null }) {
  const [lines, setLines] = useState('');
  const [category, setCategory] = useState('ADDITIONAL');
  const queued = items.filter(i => i.status === 'queued');
  return (
    <details className="panel p-4" open={items.length > 0}>
      <summary className="cursor-pointer font-semibold text-sm">
        Photo queue · {queued.length} waiting · one every {everyDays} days{nextAt ? `, next ${new Date(nextAt).toLocaleDateString('en-GB')}` : ''}
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <textarea value={lines} onChange={e => setLines(e.target.value)} rows={4} placeholder={'One public image URL per line, optional caption after a pipe:\nhttps://example.com/van.jpg | Our van outside a rewire in St Albans'} />
        <div className="flex gap-2 items-center">
          <select value={category} onChange={e => setCategory(e.target.value)} style={{ width: 160 }}>{CATS.map(c => <option key={c}>{c}</option>)}</select>
          <Action action="photos.enqueue" params={{ id: locationId, lines, category }} busy="Adding…" disabled={!lines.trim()} onDone={() => setLines('')}>Add to queue</Action>
        </div>
        {items.length > 0 && (
          <ul className="text-xs flex flex-col gap-1">
            {items.map(p => (
              <li key={p.id} className="flex items-center gap-3 panel-2 px-3 py-1.5">
                <span className={`pill ${p.status === 'posted' ? 'good' : p.status === 'failed' ? 'bad' : ''}`}>{p.status}</span>
                <a href={p.url} target="_blank" rel="noopener" className="truncate underline flex-1">{p.url}</a>
                <span className="muted truncate max-w-[220px]">{p.caption}</span>
                {p.error && <span style={{ color: 'var(--bad)' }}>{p.error}</span>}
                {p.status === 'queued' && <Action action="photos.post" params={{ id: p.id }} className="btn sm" busy="Posting…">Post now</Action>}
                {p.status === 'queued' && <Action action="photos.remove" params={{ id: p.id }} className="btn sm danger">Remove</Action>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
