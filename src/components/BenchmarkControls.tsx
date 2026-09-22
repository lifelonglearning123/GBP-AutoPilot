'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { callAction } from './Action';

export default function BenchmarkControls({ id, query, ranAt, hasSerper }: { id: string; query: string; ranAt: string | null; hasSerper: boolean }) {
  const [q, setQ] = useState(query);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const router = useRouter();

  async function go(action: 'run' | 'propose') {
    setBusy(action); setErr('');
    try {
      if (action === 'propose') setQ(await callAction<string>('benchmark.propose', { id }));
      else { await callAction('benchmark.run', { id, query: q }); router.refresh(); }
    } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  }

  return (
    <div className="panel p-4 flex flex-col gap-2">
      <div className="text-sm">
        <strong>Compare with local competitors.</strong>{' '}
        <span className="muted">The businesses Google Maps shows for the search a customer would type. Two credits per search, shared by every business in the same market for a day.</span>
      </div>
      <div className="flex gap-2">
        <input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder='e.g. electrician in Swindon'
          onKeyDown={e => { if (e.key === 'Enter' && !busy) go('run'); }} />
        <button className="btn" onClick={() => go('propose')} disabled={Boolean(busy) || !hasSerper} title="Suggest the phrase a customer would type">{busy === 'propose' ? 'Thinking…' : 'Suggest'}</button>
        <button className="btn primary" onClick={() => go('run')} disabled={Boolean(busy) || !hasSerper}>{busy === 'run' ? 'Searching…' : ranAt ? 'Re-run' : 'Run'}</button>
      </div>
      <div className="text-xs muted">
        {!hasSerper ? 'SERPER_API_KEY is not set.' : ranAt ? `Last run ${ranAt.slice(0, 16)}. Leave the box empty to have a phrase suggested.` : 'Leave the box empty to have a phrase suggested.'}
      </div>
      {err && <div className="text-xs" style={{ color: 'var(--bad)' }}>{err}</div>}
    </div>
  );
}
