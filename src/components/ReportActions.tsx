'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { callAction } from './Action';

export default function ReportActions({ id, reportUrl, pushedAt, ghlReady, show = 'all' }: {
  id: string; reportUrl: string | null; pushedAt: string | null; ghlReady: boolean; show?: 'all' | 'report' | 'ghl';
}) {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const router = useRouter();
  const view = `/api/report/${encodeURIComponent(id)}`;

  async function build() {
    setBusy('report'); setMsg('');
    try { await callAction('report.build', { id }); window.open(view, '_blank'); router.refresh(); }
    catch (e: any) { setMsg(e.message); } finally { setBusy(''); }
  }
  async function push() {
    if (!window.confirm('Create/update the contact in GHL, upload the report and add a note (and an opportunity if a pipeline is set)?')) return;
    setBusy('ghl'); setMsg('');
    try {
      const r = await callAction<{ contactId: string; reportUrl: string | null; opportunityId: string | null }>('ghl.push', { id });
      setMsg(`Pushed: contact ${r.contactId}${r.opportunityId ? ', opportunity created' : ''}${r.reportUrl ? ', report uploaded' : ', report kept local'}`);
      router.refresh();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(''); }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {show !== 'ghl' && reportUrl && <a className="btn" href={view} target="_blank" rel="noopener">View report</a>}
        {show !== 'ghl' && <button className="btn" onClick={build} disabled={Boolean(busy)}>{busy === 'report' ? 'Building…' : reportUrl ? 'Rebuild report' : 'Build report'}</button>}
        {show !== 'report' && (
          <button className="btn" onClick={push} disabled={Boolean(busy) || !ghlReady} title={ghlReady ? undefined : 'Add the GoHighLevel details on Settings first'}>
            {busy === 'ghl' ? 'Sending…' : pushedAt ? 'Send to GoHighLevel again' : 'Send to GoHighLevel'}
          </button>
        )}
      </div>
      {(msg || (show !== 'report' && pushedAt)) && <div className="text-xs muted max-w-md text-right">{msg || `In GoHighLevel since ${pushedAt!.slice(0, 16).replace('T', ' ')}`}</div>}
    </div>
  );
}
