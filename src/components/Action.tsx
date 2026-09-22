'use client';
import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

export async function callAction<T = any>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch('/api/action', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...params }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json.result as T;
}

type Props = {
  action: string;
  params?: Record<string, unknown>;
  children: ReactNode;
  className?: string;
  /** Shown while the request is in flight. */
  busy?: string;
  confirm?: string;
  onDone?: (result: any) => void;
  disabled?: boolean;
  title?: string;
};

/** A button that posts an action, refreshes the server components, and shows the error inline. */
export default function Action({ action, params, children, className = 'btn', busy, confirm: confirmMsg, onDone, disabled, title }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const router = useRouter();

  async function go() {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setPending(true); setError(''); setFlash('');
    try {
      const r = await callAction(action, params);
      onDone?.(r);
      router.refresh();
      setFlash('Done');
      setTimeout(() => setFlash(''), 1500);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" className={className} onClick={go} disabled={pending || disabled} title={title}>
        {pending ? (busy ?? 'Working…') : children}
      </button>
      {flash && <span className="text-xs" style={{ color: 'var(--good)' }}>{flash}</span>}
      {error && <span className="text-xs max-w-md" style={{ color: 'var(--bad)' }}>{error}</span>}
    </span>
  );
}
