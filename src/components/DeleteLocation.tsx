'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { callAction } from './Action';

export default function DeleteLocation({ id, linked = false }: { id: string; linked?: boolean }) {
  const router = useRouter();
  const [err, setErr] = useState('');
  async function go() {
    const msg = linked
      ? 'Remove this business from the app? Its audits, drafts and generated pages are deleted here. The Google profile itself is untouched, and syncing again will bring it back.'
      : 'Delete this business and its audits, pages and drafts?';
    if (!window.confirm(msg)) return;
    try { await callAction('location.delete', { id }); router.push('/'); router.refresh(); }
    catch (e: any) { setErr(e.message); }
  }
  return <span className="flex flex-col gap-1"><button className="btn danger" onClick={go}>Delete</button>{err && <span className="text-xs" style={{ color: 'var(--bad)' }}>{err}</span>}</span>;
}
