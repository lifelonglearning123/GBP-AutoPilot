'use client';
import { useState } from 'react';
import Action, { callAction } from './Action';
import type { QnaRow } from '@/lib/extras';

export default function QnaCard({ q, linked }: { q: QnaRow; linked: boolean }) {
  const [question, setQuestion] = useState(q.question);
  const [answer, setAnswer] = useState(q.answer);
  const [dirty, setDirty] = useState(false);
  const isDraft = q.status === 'draft';
  async function save() { await callAction('qna.edit', { id: q.id, question, answer }); setDirty(false); }
  return (
    <div className="panel p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs muted"><span>{q.posted_at ? `posted ${q.posted_at.slice(0, 16)}` : q.created_at.slice(0, 16)}</span><span className={`pill ${q.status === 'posted' ? 'good' : q.status === 'failed' ? 'bad' : 'info'}`}>{q.status}</span></div>
      {isDraft ? (
        <>
          <input type="text" value={question} onChange={e => { setQuestion(e.target.value); setDirty(true); }} />
          <textarea value={answer} onChange={e => { setAnswer(e.target.value); setDirty(true); }} rows={3} />
          {q.error && <div className="text-xs" style={{ color: 'var(--bad)' }}>{q.error}</div>}
          <div className="flex gap-2">
            {dirty && <button className="btn sm" onClick={save}>Save edit</button>}
            <Action action="qna.reject" params={{ id: q.id }} className="btn sm danger">Discard</Action>
            <Action action="qna.post" params={{ id: q.id }} className="btn sm good" busy="Posting…" disabled={dirty || !linked} title={linked ? undefined : 'Not linked to Google'}>Post to Google</Action>
          </div>
        </>
      ) : (
        <><div className="text-sm font-medium">{q.question}</div><div className="text-sm muted">{q.answer}</div></>
      )}
    </div>
  );
}
