'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { callAction } from './Action';

type Kw = { id: number; phrase: string; query: string; intent: string | null; primary: boolean; position: number | null };

const SIZES = [3, 5, 7];
/** Same groups as grid.ts: close range is searched at one zoom, the wider area at another. */
const CLOSE_RADII = [0.5, 1, 2];
const WIDE_RADII = [3, 5];
const CREDITS_PER_POINT = 3;

/**
 * Choose the grid and the searches, see the cost before running, run in the background with a
 * progress bar (the page refreshes itself while it runs), and switch on a monthly re-map.
 */
export default function GridControls({ id, keywords, running, progress, monthly, last, hasSerper, hasPin }: {
  id: string; keywords: Kw[]; running: boolean; progress: { done: number; total: number } | null; monthly: boolean;
  last: { size: number; radius: number; keywordIds: number[]; withTown: boolean } | null; hasSerper: boolean; hasPin: boolean;
}) {
  const [size, setSize] = useState(last?.size ?? 5);
  const [radius, setRadius] = useState(last?.radius ?? 2);
  const [withTown, setWithTown] = useState(last?.withTown ?? false);
  // Start from the last map's searches; otherwise just the main search (or the first tracked one), to keep the first run cheap.
  const initial = last?.keywordIds.length ? last.keywordIds : [(keywords.find(k => k.primary) ?? keywords[0])?.id].filter((x): x is number => x != null);
  const [chosen, setChosen] = useState<number[]>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const router = useRouter();

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [running, router]);

  const points = size * size;
  const credits = points * chosen.length * CREDITS_PER_POINT;
  const toggle = (kid: number) => setChosen(c => (c.includes(kid) ? c.filter(x => x !== kid) : [...c, kid]));

  async function start() {
    setBusy(true); setErr('');
    try { await callAction('grid.start', { id, size, radius, keywordIds: chosen, withTown }); router.refresh(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function setMonthly(on: boolean) {
    try { await callAction('grid.monthly', { id, on }); router.refresh(); } catch (e: any) { setErr(e.message); }
  }

  if (running && progress) {
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <div className="panel p-4 flex flex-col gap-2">
        <div className="text-sm"><strong>Checking the map…</strong> <span className="muted">{progress.done} of {progress.total} points. This page updates itself.</span></div>
        <div className="h-2 rounded" style={{ background: 'var(--line)' }}><div className="h-2 rounded transition-all" style={{ width: `${pct}%`, background: 'var(--accent)' }} /></div>
      </div>
    );
  }

  return (
    <div className="panel p-4 flex flex-col gap-3">
      <div className="text-sm">
        <strong>Map grid.</strong>{' '}
        <span className="muted">Checks this business’s position from a grid of points around it, as if a customer at each point searched Google Maps. Google ranks by distance as well as by profile, so this shows where customers can still find it.</span>
      </div>
      {!hasPin && <div className="text-sm" style={{ color: 'var(--warn)' }}>This business has no map pin yet. Link it to its Google listing first.</div>}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="field">Grid</label>
          <div className="flex gap-1">{SIZES.map(s => <button key={s} className={`btn sm ${size === s ? 'primary' : ''}`} onClick={() => setSize(s)}>{s} × {s}</button>)}</div>
        </div>
        <div>
          <label className="field">Distance from the business</label>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1" role="group" aria-label="Close range">
              <span className="text-xs muted mr-1">Close range</span>
              {CLOSE_RADII.map(r => <button key={r} type="button" aria-pressed={radius === r} className={`btn sm ${radius === r ? 'primary' : ''}`} onClick={() => setRadius(r)}>{r} mi</button>)}
            </div>
            <div className="flex items-center gap-1" role="group" aria-label="Wider area">
              <span className="text-xs muted mr-1">Wider area</span>
              {WIDE_RADII.map(r => <button key={r} type="button" aria-pressed={radius === r} className={`btn sm ${radius === r ? 'primary' : ''}`} onClick={() => setRadius(r)}>{r} mi</button>)}
            </div>
          </div>
        </div>
        <div className="text-xs muted max-w-sm">
          {radius <= 2
            ? 'Close range: every spot is searched the same way, so it gives the same position on a 0.5, 1 or 2 mile map. Best for seeing where customers stop finding the business.'
            : 'Wider area: searched further zoomed out, so the business stays in view from points 3 to 5 miles away. Shows ranking across the district. Positions are not comparable with close-range maps.'}
        </div>
      </div>
      <div>
        <label className="field">Searches to map</label>
        {keywords.length === 0 && <div className="text-sm muted">No searches tracked yet. Add them on the Competitors tab first.</div>}
        <div className="flex flex-wrap gap-1.5">
          {keywords.map(k => (
            <button key={k.id} onClick={() => toggle(k.id)} title={`Searched as "${withTown ? k.phrase : k.query}" from each point`}
              className={`btn sm ${chosen.includes(k.id) ? 'primary' : ''}`} style={{ opacity: k.intent === 'wrong' ? 0.5 : 1 }}>
              {k.phrase}
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={withTown} onChange={e => setWithTown(e.target.checked)} />
        <span>
          Keep the town in each search <span className="muted">
            {withTown ? `(searched as "${keywords.find(k => chosen.includes(k.id))?.phrase ?? 'roofer in Chippenham'}", matching the Competitors tab)`
              : `(off: searched as "${keywords.find(k => chosen.includes(k.id))?.query ?? 'roofer'}", the way someone nearby types it; wording can change the result a lot)`}
          </span>
        </span>
      </label>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs muted">
          {points} points × {chosen.length} search{chosen.length === 1 ? '' : 'es'} = {points * chosen.length} Google Maps checks, about <strong className="text-[var(--text)]">{credits} Serper credits</strong>.
          Points already checked today are reused free.
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs muted" title="Repeat the last map with the same settings every 30 days while the app is running">
            <input type="checkbox" checked={monthly} onChange={e => setMonthly(e.target.checked)} /> Monthly
          </label>
          <button className="btn primary" onClick={start} disabled={busy || !chosen.length || !hasSerper || !hasPin}>{busy ? 'Starting…' : 'Check the map'}</button>
        </div>
      </div>
      {err && <div className="text-xs" style={{ color: 'var(--bad)' }}>{err}</div>}
    </div>
  );
}
