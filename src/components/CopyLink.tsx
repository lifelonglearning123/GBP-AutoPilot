'use client';
import { useState } from 'react';

/** Copies a link and says so, for sharing the "leave a review" link with customers. */
export default function CopyLink({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
    setTimeout(() => setState('idle'), 2500);
  }
  return (
    <button type="button" className="btn sm" onClick={copy} aria-live="polite" title={text}>
      {state === 'copied' ? 'Link copied' : state === 'failed' ? 'Copy failed: select the link on Reviews' : label}
    </button>
  );
}
