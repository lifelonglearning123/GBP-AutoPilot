import { location, isLinked } from '@/lib/locations';
import { reviews } from '@/lib/reviews';
import { locId } from '@/lib/ids';
import Action from '@/components/Action';
import ReviewCard from '@/components/ReviewCard';

export const dynamic = 'force-dynamic';

export default async function ReviewsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = location(locId(id))!;
  const rs = reviews(l.id);
  const needs = rs.filter(r => !r.reply_comment && r.draft_status !== 'skipped');
  const done = rs.filter(r => r.reply_comment || r.draft_status === 'skipped');
  const avg = rs.length ? (rs.reduce((s, r) => s + r.rating, 0) / rs.length).toFixed(1) : '—';

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm muted">
          {rs.length} reviews · {avg}★ average · {needs.length} awaiting a reply
          {l.last_review_poll && <> · last checked {l.last_review_poll.slice(0, 16)}</>}
          {' · '}<span className={`pill ${l.auto_reply ? 'good' : ''}`}>Auto-reply {l.auto_reply ? 'on' : 'off'}</span>
        </div>
        <Action action="reviews.poll" params={{ id: l.id }} className="btn primary" busy="Fetching…" disabled={!isLinked(l)}>Check for new reviews</Action>
      </div>

      {rs.length === 0 && <div className="panel p-8 text-center muted">No reviews synced yet. Check for new reviews to pull them in and draft replies.</div>}

      {needs.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">Needs a reply</h2>
          {needs.map(r => <ReviewCard key={r.id} r={r} />)}
        </section>
      )}
      {done.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold muted">Replied</h2>
          {done.map(r => <ReviewCard key={r.id} r={r} />)}
        </section>
      )}
    </div>
  );
}
