'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { callAction } from './Action';

type Mode = 'auto' | 'review';

/**
 * How review replies are sent for one business: posted automatically as reviews arrive, or drafted
 * and held for approval. In automatic mode, replies to 1 and 2 star reviews can still be held.
 */
export default function ReplyMode({ id, auto, holdLow, linked, timing }: {
  id: string; auto: boolean; holdLow: boolean; linked: boolean; timing: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(auto ? 'auto' : 'review');
  const [hold, setHold] = useState(holdLow);
  const [state, setState] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; msg?: string }>({ kind: 'idle' });

  async function save(nextMode: Mode, nextHold: boolean) {
    setMode(nextMode);
    setHold(nextHold);
    setState({ kind: 'saving' });
    try {
      await callAction('location.config', { id, config: { auto_reply: nextMode === 'auto' ? 1 : 0, hold_low_stars: nextHold ? 1 : 0 } });
      setState({ kind: 'saved' });
      router.refresh();
    } catch (e: any) {
      setState({ kind: 'error', msg: e?.message ?? String(e) });
    }
  }

  const option = (value: Mode, title: string, text: string) => (
    <label className="panel-2 p-4 flex gap-3 cursor-pointer"
      style={mode === value ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 1px var(--accent)', background: 'var(--accent-tint)' } : undefined}>
      <input type="radio" name={`reply-mode-${id}`} value={value} checked={mode === value} onChange={() => save(value, hold)}
        className="mt-1 w-4 h-4 accent-[var(--accent)]" />
      <span>
        <span className="font-medium block">{title}</span>
        <span className="text-sm muted">{text}</span>
      </span>
    </label>
  );

  return (
    <fieldset className="panel p-5 flex flex-col gap-3" disabled={!linked || state.kind === 'saving'}>
      <legend className="sr-only">How replies are sent</legend>
      <div className="text-sm font-semibold">How replies are sent</div>
      <div className="grid sm:grid-cols-2 gap-3">
        {option('auto', 'Automatically', 'When a new review arrives, the AI writes a reply in the business’s voice and posts it straight away.')}
        {option('review', 'After I approve them', 'Replies are drafted and wait below until you approve each one, or all of them at once.')}
      </div>
      {mode === 'auto' && (
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={hold} onChange={e => save('auto', e.target.checked)} className="mt-0.5 w-4 h-4 accent-[var(--accent)]" />
          <span>
            Hold replies to 1 and 2 star reviews for me to check first.{' '}
            <span className="muted">Recommended: an unhappy customer should get a reply someone has read.</span>
          </span>
        </label>
      )}
      <p role="status" aria-live="polite" className="text-xs"
        style={{ color: state.kind === 'error' ? 'var(--bad)' : state.kind === 'saved' ? 'var(--good)' : 'var(--muted)' }}>
        {state.kind === 'saving' ? 'Saving…' : state.kind === 'saved' ? `Saved. ${timing}` : state.kind === 'error' ? state.msg : timing}
      </p>
    </fieldset>
  );
}
