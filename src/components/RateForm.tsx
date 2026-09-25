'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { callAction } from './Action';

/** What the suppliers charge, so the cost per business is real rather than a guess. */
export default function RateForm({ serperPer1k, aiPer1m }: { serperPer1k: number; aiPer1m: number }) {
  const router = useRouter();
  const [serper, setSerper] = useState(String(serperPer1k));
  const [ai, setAi] = useState(String(aiPer1m));
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  async function save() {
    setState('saving'); setMsg('');
    try { await callAction('usage.rates', { serperPer1k: Number(serper), aiPer1m: Number(ai) }); setState('saved'); router.refresh(); }
    catch (e: any) { setState('error'); setMsg(e?.message ?? String(e)); }
  }

  return (
    <section aria-labelledby="rates-h" className="panel p-5 flex flex-col gap-3">
      <div>
        <h2 id="rates-h" className="font-semibold">Supplier prices</h2>
        <p className="text-sm muted mt-1 max-w-prose">Change these to match your plans, and every figure above follows. In US dollars, as both suppliers bill.</p>
      </div>
      <div className="flex gap-4 flex-wrap items-end">
        <label className="text-sm">
          <span className="field">Serper, per 1,000 credits</span>
          <input type="number" step="0.10" min="0" value={serper} onChange={e => setSerper(e.target.value)} style={{ width: 130 }} />
        </label>
        <label className="text-sm">
          <span className="field">AI, per million words in and out</span>
          <input type="number" step="0.10" min="0" value={ai} onChange={e => setAi(e.target.value)} style={{ width: 130 }} />
        </label>
        <button className="btn" onClick={save} disabled={state === 'saving'}>{state === 'saving' ? 'Saving…' : 'Save prices'}</button>
        <span role="status" aria-live="polite" className="text-xs" style={{ color: state === 'error' ? 'var(--bad)' : 'var(--muted)' }}>
          {state === 'saved' ? 'Saved.' : state === 'error' ? msg : ''}
        </span>
      </div>
    </section>
  );
}
