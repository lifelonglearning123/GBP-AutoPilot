'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Action, { callAction } from './Action';

export default function BatchControls({ id, budget, running, queued, done, errors = 0 }: { id: number; budget: number; running: boolean; queued: number; done: number; errors?: number }) {
  const [b, setB] = useState(budget);
  const router = useRouter();

  // While the batch runs in the background, refresh the table every few seconds.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [running, router]);

  async function saveBudget() { await callAction('prospects.budget', { id, budget: b }); router.refresh(); }

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs muted">Budget</label>
      <input type="number" min={1} max={200} value={b} onChange={e => setB(Number(e.target.value))} style={{ width: 80 }} />
      {b !== budget && <button className="btn sm" onClick={saveBudget}>Save</button>}
      <Action action="prospects.start" params={{ id }} className="btn primary" busy="Starting…" disabled={running || queued === 0 || done >= budget}
        title={done >= budget ? 'Budget reached; raise it to continue' : undefined}>
        {running ? 'Running…' : done ? 'Continue' : 'Run audits'}
      </Action>
      {errors > 0 && <Action action="prospects.retry" params={{ id }} className="btn" busy="…">Retry {errors} failed</Action>}
      <Action action="prospects.delete" params={{ id }} className="btn danger" confirm="Delete this batch? Audited businesses stay as manual locations." onDone={() => router.push('/prospects')}>Delete</Action>
    </div>
  );
}
