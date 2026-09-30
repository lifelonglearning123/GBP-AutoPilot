import Link from 'next/link';
import type { AuditItem } from '@/lib/audit';
import CopyLink from './CopyLink';
import { TODO, atStake, nextSteps, worth } from '@/lib/steps';

type Act =
  | { kind: 'anchor' | 'link' | 'external'; href: string; label: string }
  | { kind: 'copy'; text: string; label: string }
  | { kind: 'note'; label: string };

/** A job still to do. Open circles, not red crosses: this is a list of things to do, not a list of failures. */
function Todo() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" role="img" aria-label="To do" className="shrink-0">
      <circle cx="8" cy="8" r="6.4" fill="#fff" stroke="var(--accent)" strokeWidth="1.6" />
    </svg>
  );
}

export default function NextSteps({ items, base, linked, reviewUri, phoneLocked = false, show = 3 }: {
  items: AuditItem[]; base: string; linked: boolean; reviewUri: string | null; phoneLocked?: boolean; show?: number;
}) {
  const todo = nextSteps(items);
  const total = todo.reduce((s, i) => s + atStake(i), 0);
  const edit = (href: string, label: string): Act =>
    linked ? { kind: 'anchor', href, label } : { kind: 'note', label: 'Link to Google to edit here' };

  const action = (i: AuditItem): Act => {
    switch (i.key) {
      case 'phone': return phoneLocked ? { kind: 'external', href: 'https://business.google.com/', label: 'Add in Google' } : edit('#phone', 'Add phone number');
      case 'website': return edit('#website', 'Add website');
      case 'hours': return edit('#hours', 'Set hours');
      case 'additional_categories': return edit('#categories', 'Add categories');
      case 'primary_category': return edit('#categories', 'Choose category');
      case 'description': case 'services':
        return linked ? { kind: 'anchor', href: '#ai', label: 'See drafts' } : { kind: 'note', label: 'Link to Google to edit here' };
      case 'review_count': case 'review_velocity': case 'reviews_ask':
        return reviewUri ? { kind: 'copy', text: reviewUri, label: 'Copy review link' } : { kind: 'link', href: `${base}/reviews`, label: 'Open reviews' };
      case 'rating': return { kind: 'link', href: `${base}/reviews`, label: 'Open reviews' };
      case 'reviews_replied': return { kind: 'link', href: `${base}/reviews`, label: 'Reply to reviews' };
      case 'post_weekly': return { kind: 'link', href: `${base}/posts`, label: 'Plan a post' };
      case 'nap': return { kind: 'link', href: `${base}/citations`, label: 'Check listings' };
      case 'photos': return { kind: 'link', href: `${base}/posts`, label: 'Add photos' };
      default: return { kind: 'external', href: 'https://business.google.com/', label: 'Open in Google' };
    }
  };

  const Row = ({ i }: { i: AuditItem }) => {
    const a = action(i);
    return (
      <li className="py-4 flex items-start gap-3" style={{ borderColor: 'var(--line-soft)' }}>
        <span className="mt-0.5"><Todo /></span>
        <div className="min-w-0 flex-1">
          <div className="font-medium">{TODO[i.key] ?? i.label}</div>
          <p className="text-sm muted mt-1 max-w-prose">{i.note}</p>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          {a.kind === 'anchor' && <a className="btn sm" href={a.href}>{a.label}</a>}
          {a.kind === 'link' && <Link className="btn sm" href={a.href}>{a.label}</Link>}
          {a.kind === 'external' && <a className="btn sm" href={a.href} target="_blank" rel="noopener">{a.label}</a>}
          {a.kind === 'copy' && <CopyLink text={a.text} label={a.label} />}
          {a.kind === 'note' && <span className="text-xs muted">{a.label}</span>}
          <span className="text-xs muted score">worth {worth(atStake(i))}</span>
        </div>
      </li>
    );
  };

  const first = todo.slice(0, show);
  const rest = todo.slice(show);

  return (
    <section aria-labelledby="next-h" className="scroll-mt-24">
      <h2 id="next-h" className="text-xl font-semibold">What to do next</h2>
      {todo.length === 0 ? (
        <p className="mt-2 text-sm muted max-w-prose">
          Nothing left to fix that we can check. Keep new reviews and weekly posts coming to hold the score where it is.
        </p>
      ) : (
        <>
          <p className="text-sm muted mt-1.5 max-w-prose">
            The biggest gains first. Doing all {todo.length} would add up to about {worth(total)}.
          </p>
          <ol className="mt-4 border-t divide-y" style={{ borderColor: 'var(--line-soft)' }}>
            {first.map(i => <Row key={i.key} i={i} />)}
          </ol>
          {rest.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden py-3 text-sm font-medium flex items-center gap-2 border-t"
                style={{ borderColor: 'var(--line-soft)', color: 'var(--accent-text)' }}>
                <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden className="transition-transform duration-200 group-open:rotate-180">
                  <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="group-open:hidden">Show the other {rest.length}</span>
                <span className="hidden group-open:inline">Hide the other {rest.length}</span>
              </summary>
              <ol className="divide-y border-t" style={{ borderColor: 'var(--line-soft)' }}>
                {rest.map(i => <Row key={i.key} i={i} />)}
              </ol>
            </details>
          )}
        </>
      )}
    </section>
  );
}
