'use client';
import { useState } from 'react';
import Action, { callAction } from './Action';
import type { Suggestion } from '@/lib/suggest';
import { mergeCategoryDraft } from '@/lib/cat-merge';

type Cat = { name: string; displayName?: string };
type Current = { description: string; categories: { primary?: Cat; additional: Cat[] }; services: string[] };

export default function SuggestionCard({ s, current, linked = true }: { s: Suggestion; current: Current; linked?: boolean }) {
  const proposal = JSON.parse(s.proposal_json);
  const [text, setText] = useState<string>(s.field === 'description' ? proposal : s.field === 'services' ? (proposal as string[]).join('\n') : '');
  const [saved, setSaved] = useState(true);

  async function save() {
    const value = s.field === 'description' ? text : text.split('\n').map(x => x.trim()).filter(Boolean);
    await callAction('suggest.edit', { id: s.id, proposal: value });
    setSaved(true);
  }

  const title = { description: 'Description', categories: 'Categories', services: 'Services' }[s.field];

  return (
    <div className="panel p-5 sm:p-6 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-semibold">{title}</h3>
        <div className="flex gap-2 items-center">
          {!saved && <button type="button" className="btn sm" onClick={save}>Keep my edit</button>}
          <Action action="suggest.reject" params={{ id: s.id }} className="btn sm danger">Discard</Action>
          <Action action="suggest.apply" params={{ id: s.id }} className="btn sm primary" busy="Saving to Google…" disabled={!saved || !linked} title={!saved ? 'Keep your edit first' : linked ? undefined : 'Not linked to Google'}>Approve and save to Google</Action>
        </div>
      </div>

      {s.field === 'description' && (
        <>
          <textarea value={text} onChange={e => { setText(e.target.value); setSaved(false); }} rows={6} />
          <div className="text-xs muted"><span className="score" style={text.length > 750 ? { color: 'var(--bad)' } : undefined}>{text.length} of 750 characters.</span> On Google now: {current.description ? `“${current.description.slice(0, 120)}${current.description.length > 120 ? '…' : ''}”` : 'no description'}</div>
        </>
      )}

      {s.field === 'categories' && (() => {
        const after = mergeCategoryDraft({ primary: current.categories.primary ?? null, additional: current.categories.additional }, proposal);
        return (
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-xs font-semibold muted mb-1.5">On Google now</div>
              <div>{current.categories.primary?.displayName ?? 'No primary'} <span className="pill">primary</span></div>
              <ul className="mt-1.5 flex flex-col gap-0.5 muted">
                {current.categories.additional.map(c => <li key={c.name}>{c.displayName}</li>)}
                {!current.categories.additional.length && <li>No additional categories</li>}
              </ul>
            </div>
            <div>
              <div className="text-xs font-semibold mb-1.5" style={{ color: 'var(--accent-text)' }}>After you approve</div>
              <div>{after.primary.displayName} <span className="pill info">primary</span></div>
              <ul className="mt-1.5 flex flex-col gap-0.5">
                {after.additional.map(c => (
                  <li key={c.name}>{c.displayName}{c.isNew && <span className="text-xs font-semibold ml-1.5" style={{ color: 'var(--good)' }}>new</span>}</li>
                ))}
                {!after.additional.length && <li className="muted">No additional categories</li>}
              </ul>
              <p className="text-xs muted mt-2">
                Approving adds to what is on Google and keeps everything already there{after.dropped.length ? `, except ${after.dropped.map(c => c.displayName).join(', ')}, which would go over Google’s limit of 9` : ''}. Remove categories in Business details.
              </p>
            </div>
          </div>
        );
      })()}

      {s.field === 'services' && (
        <>
          <textarea value={text} onChange={e => { setText(e.target.value); setSaved(false); }} rows={8} />
          <div className="text-xs muted">One service per line. These replace the typed-in services on the profile ({current.services.length} there now). Services picked from Google’s own list stay.</div>
        </>
      )}

      {s.rationale && <p className="text-xs muted border-t pt-3" style={{ borderColor: 'var(--line-soft)' }}><span className="font-semibold" style={{ color: 'var(--text)' }}>Why: </span>{s.rationale}</p>}
    </div>
  );
}
