'use client';
import { useEffect, useRef, useState } from 'react';
import { callAction } from './Action';

export type Cat = { name: string; displayName: string };
export type Cats = { primary: Cat | null; additional: Cat[] };

const MAX_ADDITIONAL = 9;

/**
 * Categories picked from Google's own list: search, add, remove, choose the primary. Only names that
 * Google's category search returned can be added, so nothing invented can reach the profile.
 */
export type Rivals = { checkedAt: string; top: number; list: { name: string; count: number; by: string[] }[] } | null;

export default function CategoryPicker({ id, value, onChange, drafts = [], disabled = false, hideLegend = false, rivals = null, competitorsHref }: {
  id: string; value: Cats; onChange: (next: Cats) => void; drafts?: Cat[]; disabled?: boolean;
  /** Categories the competitors outranking this business use and it does not (latest competitor check). */
  rivals?: Rivals;
  competitorsHref?: string;
  /** Inside a titled part the heading is already visible; keep the legend for screen readers only. */
  hideLegend?: boolean;
}) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<Cat[]>([]);
  const [state, setState] = useState<{ kind: 'idle' | 'searching' | 'error'; msg?: string }>({ kind: 'idle' });
  const seq = useRef(0);
  const [adding, setAdding] = useState<{ name: string; error?: string } | null>(null);

  const chosen = new Set([value.primary?.name, ...value.additional.map(c => c.name)].filter(Boolean) as string[]);
  const full = value.additional.length >= MAX_ADDITIONAL;

  // Search as the person types, a moment after they stop, ignoring answers to older searches.
  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) { setResults([]); setState({ kind: 'idle' }); return; }
    const mine = ++seq.current;
    setState({ kind: 'searching' });
    const t = setTimeout(async () => {
      try {
        const list = await callAction<Cat[]>('categories.search', { id, term: q });
        if (mine === seq.current) { setResults(list); setState({ kind: 'idle' }); }
      } catch (e: any) {
        if (mine === seq.current) { setResults([]); setState({ kind: 'error', msg: e?.message ?? String(e) }); }
      }
    }, 350);
    return () => clearTimeout(t);
  }, [term, id]);

  const add = (c: Cat) => { if (!chosen.has(c.name) && !full) onChange({ ...value, additional: [...value.additional, c] }); };
  const remove = (c: Cat) => onChange({ ...value, additional: value.additional.filter(x => x.name !== c.name) });
  const makePrimary = (c: Cat) => onChange({
    primary: c,
    // The old primary becomes an additional category, so it is not lost by accident.
    additional: [...value.additional.filter(x => x.name !== c.name), ...(value.primary && value.primary.name !== c.name ? [value.primary] : [])].slice(0, MAX_ADDITIONAL),
  });
  const draftsToAdd = drafts.filter(d => !chosen.has(d.name));
  const chosenNames = new Set([value.primary?.displayName, ...value.additional.map(c => c.displayName)].filter(Boolean).map(n => n!.toLowerCase()));
  const rivalsToAdd = (rivals?.list ?? []).filter(r => !chosenNames.has(r.name.toLowerCase()));
  // A competitor's category comes as a name; match it to Google's own category before adding it.
  async function addRival(name: string) {
    setAdding({ name });
    try {
      const c = await callAction<Cat>('categories.resolve', { id, name });
      add(c);
      setAdding(null);
    } catch (e: any) {
      setAdding({ name, error: e?.message ?? String(e) });
    }
  }
  const checked = rivals?.checkedAt ? new Date(rivals.checkedAt.replace(' ', 'T') + 'Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';

  return (
    <fieldset id="categories" className="scroll-mt-28 flex flex-col gap-3" disabled={disabled}>
      <legend className={hideLegend ? 'sr-only' : 'text-sm font-semibold'}>Categories</legend>
      <p className={`text-xs muted ${hideLegend ? '' : '-mt-1'}`}>
        The primary category says what the business is and matters most. Additional categories add searches the business can appear in. Add only ones that are true: Google can suspend a profile for categories it does not fit.
      </p>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <span className="font-medium w-24 shrink-0">Primary</span>
          {value.primary
            ? <span className="pill info">{value.primary.displayName}</span>
            : <span className="text-sm" style={{ color: 'var(--bad)' }}>None set. Search below and choose Make primary.</span>}
        </div>
        <div className="flex items-start gap-2 flex-wrap text-sm">
          <span className="font-medium w-24 shrink-0 pt-1">Additional</span>
          <div className="flex gap-2 flex-wrap flex-1 min-w-0">
            {value.additional.length === 0 && <span className="muted pt-1">None yet.</span>}
            {value.additional.map(c => (
              <span key={c.name} className="inline-flex items-center gap-1 pl-3 pr-1 py-0.5 rounded-full border text-sm" style={{ borderColor: 'var(--line-strong)' }}>
                {c.displayName}
                <button type="button" onClick={() => remove(c)} aria-label={`Remove ${c.displayName}`} className="w-6 h-6 rounded-full inline-flex items-center justify-center hover:bg-[var(--panel-2)]">
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                </button>
              </span>
            ))}
            <span className="text-xs muted self-center score">{value.additional.length} of {MAX_ADDITIONAL}</span>
          </div>
        </div>
        {full && (
          <p className="text-xs" style={{ color: 'var(--warn)' }}>
            Google allows {MAX_ADDITIONAL} additional categories and this business has {MAX_ADDITIONAL}. Remove one to add another.
          </p>
        )}
      </div>

      {draftsToAdd.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <span className="text-xs font-semibold" style={{ color: 'var(--accent-text)' }}>From the AI draft:</span>
          {draftsToAdd.map(c => (
            <button key={c.name} type="button" className="btn sm" disabled={full} onClick={() => add(c)}>Add {c.displayName}</button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="text-xs font-semibold">Used by the competitors that outrank you</div>
        {rivals === null ? (
          <p className="text-xs muted">
            No competitor check yet.{competitorsHref && <> <a className="underline" href={competitorsHref}>Run one on the Competitors tab</a></>} to see the categories used by the businesses above this one.
          </p>
        ) : rivalsToAdd.length === 0 ? (
          <p className="text-xs muted">This business already uses every category its top {rivals.top} competitors use{checked ? ` (checked ${checked})` : ''}.</p>
        ) : (
          <>
            <div className="flex gap-2 flex-wrap">
              {rivalsToAdd.map(r => (
                <button key={r.name} type="button" className="btn sm" disabled={full || adding?.name === r.name && !adding.error}
                  title={`Used by ${r.by.join(', ')}`} onClick={() => addRival(r.name)}>
                  {adding?.name === r.name && !adding.error ? 'Adding…' : `Add ${r.name}`}
                  <span className="muted font-normal">{r.count} of {rivals.top}</span>
                </button>
              ))}
            </div>
            {adding?.error && <p className="text-xs" style={{ color: 'var(--bad)' }}>{adding.error}</p>}
            <p className="text-xs muted">
              From the competitor check{checked ? ` on ${checked}` : ''}: how many of the top {rivals.top} list each category. Hover to see which ones. Add a category only if this business does that work too.
            </p>
          </>
        )}
      </div>

      <div>
        <label className="field" htmlFor="category-search">Find a category in Google’s list</label>
        <input id="category-search" type="search" autoComplete="off" placeholder="For example: marketing, software, consultant"
          value={term} onChange={e => setTerm(e.target.value)} aria-describedby="category-search-status" />
        <p id="category-search-status" role="status" aria-live="polite" className="text-xs mt-1.5"
          style={{ color: state.kind === 'error' ? 'var(--bad)' : 'var(--muted)' }}>
          {state.kind === 'searching' ? 'Searching Google’s categories…'
            : state.kind === 'error' ? state.msg
            : term.trim().length >= 2 ? `${results.length} categor${results.length === 1 ? 'y' : 'ies'} contain “${term.trim()}”.`
            : 'Type a word from what the business does. Only Google’s own categories can be added.'}
        </p>
        {results.length > 0 && (
          <ul className="mt-2 border rounded-lg divide-y max-h-72 overflow-y-auto" style={{ borderColor: 'var(--line)' }}>
            {results.map(c => {
              const isPrimary = value.primary?.name === c.name;
              const added = chosen.has(c.name);
              return (
                <li key={c.name} className="flex items-center justify-between gap-3 px-3 py-2 text-sm" style={{ borderColor: 'var(--line-soft)' }}>
                  <span className={added ? 'muted' : ''}>{c.displayName}</span>
                  <span className="flex gap-2 shrink-0">
                    {isPrimary ? <span className="text-xs muted">Primary</span> : (
                      <>
                        <button type="button" className="btn sm" onClick={() => makePrimary(c)}>Make primary</button>
                        <button type="button" className="btn sm" disabled={added || full} onClick={() => add(c)}
                          title={full ? 'Google allows up to 9 additional categories' : undefined}>{added ? 'Added' : 'Add'}</button>
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </fieldset>
  );
}
