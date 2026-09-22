'use client';
import { useState } from 'react';
import Action, { callAction } from './Action';
import type { ReviewRow } from '@/lib/reviews';

export default function ReviewCard({ r }: { r: ReviewRow }) {
  const [draft, setDraft] = useState(r.draft_reply ?? '');
  const [dirty, setDirty] = useState(false);
  const replied = Boolean(r.reply_comment);
  const stars = '★'.repeat(r.rating) + '☆'.repeat(Math.max(0, 5 - r.rating));

  async function save() { await callAction('reviews.edit', { id: r.id, reply: draft }); setDirty(false); }

  return (
    <div className="panel p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className={r.rating >= 4 ? 'text-[var(--good)]' : r.rating === 3 ? 'text-[var(--warn)]' : 'text-[var(--bad)]'}>{stars}</span>
          <span className="ml-2 font-medium">{r.reviewer}</span>
          <span className="ml-2 text-xs muted">{r.create_time?.slice(0, 10)}</span>
        </div>
        <span className={`pill ${replied ? 'good' : r.draft_status === 'failed' ? 'bad' : r.draft_status === 'draft' ? 'info' : ''}`}>{replied ? 'replied' : r.draft_status}</span>
      </div>
      <p className="text-sm">{r.comment || <span className="muted">Rating only, no text.</span>}</p>

      {replied ? (
        <div className="panel-2 px-3 py-2 text-sm"><span className="text-xs muted uppercase">Reply</span><div>{r.reply_comment}</div></div>
      ) : r.draft_status === 'skipped' ? null : (
        <div className="flex flex-col gap-2">
          <textarea value={draft} onChange={e => { setDraft(e.target.value); setDirty(true); }} rows={3} placeholder="No draft yet. Generate one." />
          {r.draft_error && <div className="text-xs" style={{ color: 'var(--bad)' }}>{r.draft_error}</div>}
          <div className="flex gap-2 flex-wrap">
            <Action action="reviews.draft" params={{ id: r.id }} className="btn sm" busy="Drafting…" onDone={(t: string) => { setDraft(t); setDirty(false); }}>{draft ? 'Redraft' : 'Draft reply'}</Action>
            {dirty && <button className="btn sm" onClick={save}>Save edit</button>}
            <Action action="reviews.skip" params={{ id: r.id }} className="btn sm">Skip</Action>
            <Action action="reviews.post" params={{ id: r.id }} className="btn sm good" busy="Posting…" disabled={!draft || dirty}>Post reply</Action>
          </div>
        </div>
      )}
    </div>
  );
}
