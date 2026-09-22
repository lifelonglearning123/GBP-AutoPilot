import Link from 'next/link';
import type { AuditItem } from '@/lib/audit';
import { pts } from '@/lib/format';
import StatusIcon from './StatusIcon';
import CopyLink from './CopyLink';

type Act =
  | { kind: 'anchor' | 'link' | 'external'; href: string; label: string }
  | { kind: 'copy'; text: string; label: string }
  | { kind: 'note'; label: string };

/** What to do, in the words of someone doing it, rather than the name of the check. */
const TODO: Record<string, string> = {
  phone: 'Add a phone number',
  website: 'Add a website',
  hours: 'Set opening hours for every day you open',
  description: 'Write a fuller description',
  services: 'List more of the services you offer',
  additional_categories: 'Add more categories',
  primary_category: 'Choose a primary category',
  review_count: 'Get more reviews',
  review_velocity: 'Get new reviews every month',
  rating: 'Lift the star rating',
  reviews_replied: 'Reply to every review',
  post_weekly: 'Publish a post every week',
  nap: 'Make the name, address and phone match everywhere',
  photos: 'Add new photos every month',
};

export default function NextSteps({ items, base, linked, reviewUri, phoneLocked = false }: {
  items: AuditItem[]; base: string; linked: boolean; reviewUri: string | null; phoneLocked?: boolean;
}) {
  const atStake = (i: AuditItem) => i.weight * (1 - i.points);
  const todo = items.filter(i => !i.unknown && !i.ok).sort((a, b) => atStake(b) - atStake(a));
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
      case 'review_count': case 'review_velocity':
        return reviewUri ? { kind: 'copy', text: reviewUri, label: 'Copy review link' } : { kind: 'link', href: `${base}/reviews`, label: 'Open reviews' };
      case 'rating': return { kind: 'link', href: `${base}/reviews`, label: 'Open reviews' };
      case 'reviews_replied': return { kind: 'link', href: `${base}/reviews`, label: 'Reply to reviews' };
      case 'post_weekly': return { kind: 'link', href: `${base}/posts`, label: 'Plan a post' };
      case 'nap': return { kind: 'link', href: `${base}/citations`, label: 'Check listings' };
      default: return { kind: 'external', href: 'https://business.google.com/', label: 'Open in Google' };
    }
  };

  return (
    <section aria-labelledby="next-h">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <h2 id="next-h" className="text-lg font-semibold">Next steps</h2>
        {todo.length > 0 && <span className="text-sm muted score">{todo.length} to do, worth up to {pts(total)} points</span>}
      </div>
      {todo.length === 0 ? (
        <p className="mt-3 text-sm">Nothing left to fix that the app can check. Keep new reviews and weekly posts coming to hold the score.</p>
      ) : (
        <>
          <p className="text-sm muted mt-1">Biggest gains first.</p>
          <ol className="mt-3 border-y divide-y" style={{ borderColor: 'var(--line)' }}>
            {todo.map(i => {
              const a = action(i);
              return (
                <li key={i.key} className="py-3.5 flex items-start gap-3" style={{ borderColor: 'var(--line)' }}>
                  <span className="mt-0.5"><StatusIcon grade={i.grade} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-x-2.5 gap-y-0.5 flex-wrap">
                      <span className="font-medium">{TODO[i.key] ?? i.label}</span>
                      <span className="text-xs font-semibold score" style={{ color: 'var(--accent-text)' }}>+{pts(atStake(i))} points</span>
                    </div>
                    <p className="text-sm muted mt-0.5 max-w-prose">{i.note}</p>
                  </div>
                  <div className="shrink-0">
                    {a.kind === 'anchor' && <a className="btn sm" href={a.href}>{a.label}</a>}
                    {a.kind === 'link' && <Link className="btn sm" href={a.href}>{a.label}</Link>}
                    {a.kind === 'external' && <a className="btn sm" href={a.href} target="_blank" rel="noopener">{a.label}</a>}
                    {a.kind === 'copy' && <CopyLink text={a.text} label={a.label} />}
                    {a.kind === 'note' && <span className="text-xs muted">{a.label}</span>}
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
