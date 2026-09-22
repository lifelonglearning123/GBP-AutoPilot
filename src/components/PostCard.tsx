'use client';
import { useState } from 'react';
import Action, { callAction } from './Action';
import type { PostRow } from '@/lib/posts';

export default function PostCard({ p, linked = true }: { p: PostRow; linked?: boolean }) {
  const [summary, setSummary] = useState(p.summary);
  const [media, setMedia] = useState(p.media_url ?? '');
  const [dirty, setDirty] = useState(false);
  const isDraft = p.status === 'draft';

  async function save() {
    await callAction('posts.edit', { id: p.id, patch: { summary, media_url: media || null } });
    setDirty(false);
  }

  return (
    <div className="panel p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 text-xs muted">
        <span>{p.angle?.split(' | ')[0]} · {p.created_at.slice(0, 16)}{p.posted_at ? ` · posted ${p.posted_at.slice(0, 16)}` : ''}</span>
        <span className={`pill ${p.status === 'posted' ? 'good' : p.status === 'failed' ? 'bad' : p.status === 'draft' ? 'info' : ''}`}>{p.status}</span>
      </div>
      {isDraft ? (
        <>
          <textarea value={summary} onChange={e => { setSummary(e.target.value); setDirty(true); }} rows={7} />
          <div className="grid gap-2" style={{ gridTemplateColumns: '1fr auto' }}>
            <input type="url" value={media} onChange={e => { setMedia(e.target.value); setDirty(true); }} placeholder="Photo URL (public https, optional)" />
            <span className="text-xs muted self-center">{summary.length}/1500</span>
          </div>
          {p.angle?.includes('photo:') && <div className="text-xs muted">Photo idea: {p.angle.split('photo: ')[1]}</div>}
          <div className="text-xs muted">Button: {p.cta_type ?? 'none'}{p.cta_url ? ` → ${p.cta_url}` : ''}</div>
          {p.error && <div className="text-xs" style={{ color: 'var(--bad)' }}>{p.error}</div>}
          <div className="flex gap-2 flex-wrap">
            {dirty && <button className="btn sm" onClick={save}>Save edit</button>}
            <Action action="posts.reject" params={{ id: p.id }} className="btn sm danger">Discard</Action>
            <Action action="posts.publish" params={{ id: p.id }} className="btn sm good" busy="Publishing…" disabled={dirty || !linked} title={linked ? undefined : 'Not linked to Google'}>Publish to Google</Action>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm whitespace-pre-wrap">{p.summary}</p>
          {p.error && <div className="text-xs" style={{ color: 'var(--bad)' }}>{p.error}</div>}
          {p.status === 'failed' && <div><Action action="posts.publish" params={{ id: p.id }} className="btn sm" busy="Retrying…">Retry</Action></div>}
        </>
      )}
    </div>
  );
}
