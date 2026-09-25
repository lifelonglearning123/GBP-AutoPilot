import { location, isLinked } from '@/lib/locations';
import { reviews } from '@/lib/reviews';
import { locId } from '@/lib/ids';
import Action from '@/components/Action';
import ReviewCard from '@/components/ReviewCard';
import ReplyMode from '@/components/ReplyMode';
import AlertList from '@/components/AlertList';
import { openAlerts } from '@/lib/alerts';
import { viaPipedream, pipedreamWindows } from '@/lib/gauth';

export const dynamic = 'force-dynamic';

export default async function ReviewsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = location(locId(id))!;
  const rs = reviews(l.id);
  const needs = rs.filter(r => !r.reply_comment && r.draft_status !== 'skipped');
  const done = rs.filter(r => r.reply_comment || r.draft_status === 'skipped');
  const avg = rs.length ? (rs.reduce((s, r) => s + r.rating, 0) / rs.length).toFixed(1) : '—';
  // Drafts waiting to be posted. Replies to 1 and 2 star reviews are always approved one by one.
  const drafted = needs.filter(r => r.draft_status === 'draft' && (r.draft_reply ?? '').trim());
  const bulk = drafted.filter(r => r.rating > 2).length;
  const lowDrafts = drafted.length - bulk;
  const timing = viaPipedream()
    ? `New reviews are checked at ${pipedreamWindows().map(h => `${h}:00`).join(' and ')} while Google access goes through Pipedream, and whenever you press Check for new reviews.`
    : 'New reviews are checked every hour while the app is running, and whenever you press Check for new reviews.';

  return (
    <div className="flex flex-col gap-5">
      <AlertList alerts={openAlerts(l.id)} showBusiness={false} />
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm muted">
          {rs.length} reviews · {avg}★ average · {needs.length} awaiting a reply
          {l.last_review_poll && <> · last checked {l.last_review_poll.slice(0, 16)}</>}
        </div>
        <Action action="reviews.poll" params={{ id: l.id }} className="btn primary" busy="Fetching…" disabled={!isLinked(l)}>Check for new reviews</Action>
      </div>

      <ReplyMode id={l.id} auto={Boolean(l.auto_reply)} holdLow={Boolean(l.hold_low_stars)} linked={isLinked(l)} timing={timing} />

      {bulk > 0 && (
        <div className="panel p-4 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm">
            <strong>{bulk} {bulk === 1 ? 'reply is' : 'replies are'} drafted</strong> for 3 to 5 star reviews and waiting.
            {lowDrafts > 0 && <span className="muted"> {lowDrafts} to 1 and 2 star reviews wait below for you to approve one by one.</span>}
          </p>
          <Action action="reviews.postAll" params={{ id: l.id }} className="btn primary" busy="Posting…"
            confirm={`Post ${bulk} replies to Google now? Each one appears publicly under its review.`}>Approve and post all {bulk}</Action>
        </div>
      )}

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
