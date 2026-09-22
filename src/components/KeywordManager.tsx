'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { callAction } from './Action';
import type { KeywordRow } from '@/lib/keywords';

const SOURCE: Record<string, string> = { primary: 'main search', category: 'Google category', service: 'service', autocomplete: 'Google autocomplete', suggested: 'suggested', manual: 'added by you' };

/** Run bar: check every tracked search now, and the weekly re-check switch. */
export function KeywordRunBar({ id, weekly, ranAt, nextAt, active, hasSerper }: { id: string; weekly: boolean; ranAt: string | null; nextAt: string | null; active: number; hasSerper: boolean }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const router = useRouter();
  async function act(name: string, action: string, params: Record<string, unknown>) {
    setBusy(name); setErr('');
    try { await callAction(action, params); router.refresh(); } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  }
  return (
    <div className="panel p-4 flex items-center justify-between gap-4 flex-wrap">
      <div className="text-sm">
        <strong>Competitor analysis across the searches customers use.</strong>{' '}
        <span className="muted">
          {active ? `${active} search${active === 1 ? '' : 'es'} tracked. ` : 'No searches tracked yet. '}
          {ranAt ? `Last checked ${ranAt.slice(0, 16)}.` : ''}
          {weekly && nextAt && ranAt ? ` Next weekly check ${new Date(nextAt).toLocaleDateString('en-GB')}.` : ''}
        </span>
        {err && <div className="text-xs mt-1" style={{ color: 'var(--bad)' }}>{err}</div>}
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs muted" title="Re-check the tracked searches every week while the app is running">
          <input type="checkbox" checked={weekly} disabled={Boolean(busy)} onChange={e => act('weekly', 'keywords.weekly', { id, on: e.target.checked })} /> Weekly
        </label>
        <button className="btn primary" disabled={Boolean(busy) || !hasSerper} onClick={() => act('run', 'keywords.run', { id })}>
          {busy === 'run' ? `Checking ${active || 8} searches…` : ranAt ? 'Check again' : active ? 'Check searches' : 'Suggest and check'}
        </button>
      </div>
    </div>
  );
}

/** The list of searches: tick to track, add your own, swap a wrong-intent phrase for the suggested one. */
export default function KeywordManager({ id, keywords, hasSerper }: { id: string; keywords: KeywordRow[]; hasSerper: boolean }) {
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const router = useRouter();
  async function act(name: string, action: string, params: Record<string, unknown>) {
    setBusy(name); setErr('');
    try { await callAction(action, params); router.refresh(); return true; } catch (e: any) { setErr(e.message); return false; } finally { setBusy(''); }
  }
  const active = keywords.filter(k => k.active).length;

  return (
    <details className="panel p-4" open={keywords.length === 0}>
      <summary className="cursor-pointer font-semibold text-sm">Searches tracked ({active}) <span className="muted font-normal">· tick to track, or add your own</span></summary>
      <div className="mt-3 flex flex-col gap-3">
        <div className="flex gap-2">
          <input type="text" value={phrase} onChange={e => setPhrase(e.target.value)} placeholder='A search a customer would type, e.g. "EV charger installer Swindon"'
            onKeyDown={async e => { if (e.key === 'Enter' && phrase.trim() && await act('add', 'keywords.add', { id, phrase })) setPhrase(''); }} />
          <button className="btn" disabled={!phrase.trim() || Boolean(busy)} onClick={async () => { if (await act('add', 'keywords.add', { id, phrase })) setPhrase(''); }}>Add</button>
          <button className="btn" disabled={Boolean(busy) || !hasSerper} onClick={() => act('suggest', 'keywords.suggest', { id })}>{busy === 'suggest' ? 'Suggesting…' : 'Suggest searches'}</button>
        </div>
        {err && <div className="text-xs" style={{ color: 'var(--bad)' }}>{err}</div>}
        <ul className="flex flex-col gap-1">
          {keywords.map(k => (
            <li key={k.id} className="panel-2 px-3 py-1.5 flex items-center gap-3 text-sm">
              <input type="checkbox" checked={Boolean(k.active)} disabled={Boolean(busy)} onChange={e => act(`t${k.id}`, 'keywords.toggle', { kid: k.id, active: e.target.checked })} />
              <span className={`flex-1 ${k.active ? '' : 'muted'}`}>
                {k.phrase}
                {k.intent === 'wrong' && (
                  <span className="text-xs block" style={{ color: 'var(--warn)' }}>
                    Returns {k.intent_note || 'the wrong kind of business'}.
                    {k.suggestion && <> <button className="underline" onClick={() => act(`s${k.id}`, 'keywords.useSuggestion', { kid: k.id })}>Use "{k.suggestion}" instead</button></>}
                  </span>
                )}
                {(k.intent === 'thin' || k.intent === 'error') && <span className="text-xs block" style={{ color: 'var(--warn)' }}>{k.intent_note}</span>}
              </span>
              <span className="text-xs muted whitespace-nowrap">{SOURCE[k.source] ?? k.source}</span>
              <button className="text-xs muted hover:text-[var(--bad)]" title="Remove" disabled={Boolean(busy)} onClick={() => act(`r${k.id}`, 'keywords.remove', { kid: k.id })}>✕</button>
            </li>
          ))}
          {keywords.length === 0 && <li className="text-sm muted">None yet. Click Suggest searches, or add the ones you know customers use.</li>}
        </ul>
        <div className="text-xs muted">Each search costs about 2 Serper credits per check and is shared with every business in the same town for a day. Up to 20 results are read per search.</div>
      </div>
    </details>
  );
}
