'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { callAction } from './Action';

export default function NewBatch({ hasSerper }: { hasSerper: boolean }) {
  const [mode, setMode] = useState<'search' | 'csv'>('search');
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [csv, setCsv] = useState('');
  const [budget, setBudget] = useState(10);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function create() {
    setBusy(true); setMsg('');
    try {
      const b = mode === 'search'
        ? await callAction<{ id: number }>('prospects.search', { name, query, budget })
        : await callAction<{ id: number }>('prospects.importCsv', { name, csv, budget });
      router.push(`/prospects/${b.id}`); router.refresh();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="panel p-5 flex flex-col gap-3">
      <div className="flex gap-1">
        <button className={`tab ${mode === 'search' ? 'active' : ''}`} onClick={() => setMode('search')}>Search Google Maps</button>
        <button className={`tab ${mode === 'csv' ? 'active' : ''}`} onClick={() => setMode('csv')}>Paste a CSV</button>
      </div>
      {mode === 'search' ? (
        <>
          <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder='e.g. "electricians in St Albans" — returns up to ~20 businesses with address, phone and website' />
          {!hasSerper && <div className="text-xs" style={{ color: 'var(--warn)' }}>SERPER_API_KEY is not set.</div>}
        </>
      ) : (
        <textarea value={csv} onChange={e => setCsv(e.target.value)} rows={6} placeholder={'name,street,town,postcode,phone,website,category\nBright Spark Electrical,12 Holywell Hill,St Albans,AL1 3AA,01727 000000,https://…,Electrician'} />
      )}
      <div className="grid gap-3 items-end" style={{ gridTemplateColumns: '2fr 1fr auto' }}>
        <div><label className="field">Batch name (optional)</label><input type="text" value={name} onChange={e => setName(e.target.value)} /></div>
        <div><label className="field">Audit budget (max businesses)</label><input type="number" min={1} max={100} value={budget} onChange={e => setBudget(Number(e.target.value))} /></div>
        <button className="btn primary" onClick={create} disabled={busy || (mode === 'search' ? !query.trim() : !csv.trim())}>{busy ? 'Creating…' : 'Create batch'}</button>
      </div>
      <div className="text-xs muted">Each audit is about a minute, roughly 15 Serper searches and 30 to 40 model calls. The budget caps how many run; raise it on the batch page later.</div>
      {msg && <div className="text-xs" style={{ color: 'var(--bad)' }}>{msg}</div>}
    </div>
  );
}
