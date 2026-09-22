'use client';
import type { ReactNode } from 'react';
import StatusIcon from './StatusIcon';

type Grade = 'good' | 'partial' | 'poor' | 'unknown';

/**
 * One part of the business details: a summary row that opens into the fields. Finished parts sit
 * closed so the eye goes to what still needs work. The row is a real button with aria-expanded, and
 * the closed body is inert so keyboard focus never lands in hidden fields.
 */
export default function FormPart({ id, title, summary, grade, open, onToggle, edited = false, children }: {
  id: string; title: string; summary: ReactNode; grade: Grade; open: boolean; onToggle: () => void; edited?: boolean; children: ReactNode;
}) {
  const body = `${id}-part-body`;
  return (
    <section id={`part-${id}`} aria-labelledby={`${id}-part-head`} className="border-t scroll-mt-28" style={{ borderColor: 'var(--line)' }}>
      <h3 id={`${id}-part-head`} className="m-0">
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={body}
          className="w-full flex items-center gap-3 py-3.5 px-2 -mx-2 text-left rounded-lg hover:bg-[var(--panel-2)]" style={{ width: 'calc(100% + 1rem)' }}>
          <StatusIcon grade={grade} />
          <span className="text-sm font-semibold w-32 shrink-0">{title}</span>
          <span className="text-sm flex-1 min-w-0 truncate muted" style={{ fontFamily: 'var(--font-body)' }}>{open ? '' : summary}</span>
          {edited && !open && <span className="pill warn shrink-0" style={{ fontFamily: 'var(--font-body)' }}>Edited, not saved</span>}
          <span className="text-xs font-semibold shrink-0" style={{ color: 'var(--accent-text)', fontFamily: 'var(--font-body)' }}>{open ? 'Close' : 'Edit'}</span>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0 transition-transform duration-200"
            style={{ transform: open ? 'rotate(180deg)' : 'none', color: 'var(--accent-text)' }}>
            <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </h3>
      <div id={body} className="grid transition-[grid-template-rows] duration-200 ease-out" style={{ gridTemplateRows: open ? '1fr' : '0fr' }} inert={!open}>
        <div className="overflow-hidden">
          <div className="px-1 pt-1 pb-5">{children}</div>
        </div>
      </div>
    </section>
  );
}
