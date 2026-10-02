import { all, one, run, log } from './db';
import { text as llmText } from './llm';
import { location, view, type LocationRow } from './locations';
import { getReview, readReviews, replyToReview, STARS } from './gbp';
import { alertBadReview } from './alerts';

export type ReviewRow = {
  id: string; location_id: string; reviewer: string | null; rating: number; comment: string | null;
  create_time: string | null; update_time: string | null; reply_comment: string | null; reply_time: string | null;
  draft_reply: string | null; draft_status: 'none' | 'draft' | 'posted' | 'skipped' | 'failed'; draft_error: string | null; fetched_at: string;
};

export function reviews(locationId: string): ReviewRow[] {
  return all<ReviewRow>('SELECT * FROM reviews WHERE location_id = ? ORDER BY create_time DESC', locationId);
}
export function review(id: string): ReviewRow | undefined {
  return one<ReviewRow>('SELECT * FROM reviews WHERE id = ?', id);
}

/**
 * Automatic replies only go to reviews Google dates within this many days. A newly linked business
 * has every old review read as new on its first check, and without a limit switching automatic
 * replies on answered reviews from years ago, all in one minute. Older ones are still drafted, and
 * wait for a person. The same limit alerts use (alerts.ts).
 */
export const AUTO_REPLY_FRESH_DAYS = 14;

function fresh(createTime: string | null | undefined): boolean {
  const at = createTime ? Date.parse(createTime) : NaN;
  return Number.isFinite(at) && Date.now() - at <= AUTO_REPLY_FRESH_DAYS * 86_400_000;
}

/**
 * Pull reviews, store new ones, draft replies for anything unanswered, and post the drafts
 * straight away when the location is on auto-reply.
 */
export async function poll(locationId: string): Promise<{ fetched: number; newUnreplied: number; posted: number }> {
  const l = location(locationId);
  if (!l) throw new Error('Unknown location');
  const read = await readReviews(l.account, l.id);
  const gs = read.reviews;
  run('UPDATE locations SET reviews_total = ?, reviews_avg = ? WHERE id = ?', read.total, read.average, l.id);
  let newUnreplied = 0, posted = 0;

  for (const g of gs) {
    const existing = review(g.reviewId);
    const rating = STARS[g.starRating ?? ''] ?? 0;
    const replyComment = g.reviewReply?.comment ?? null;
    // A customer can edit a review after a reply was drafted for it. The draft answers words that
    // are no longer there (a thank-you under what is now a complaint), so it is thrown away and a
    // new one is written on the next check. A skipped review stays skipped.
    const changed = Boolean(existing) && !replyComment && (existing!.draft_status === 'draft' || existing!.draft_status === 'failed')
      && ((existing!.comment ?? '') !== (g.comment ?? '') || existing!.rating !== rating);
    run(
      `INSERT INTO reviews (id, location_id, reviewer, rating, comment, create_time, update_time, reply_comment, reply_time, draft_status)
       VALUES (?,?,?,?,?,?,?,?,?, ?)
       ON CONFLICT(id) DO UPDATE SET reviewer = excluded.reviewer, rating = excluded.rating, comment = excluded.comment,
         update_time = excluded.update_time, reply_comment = excluded.reply_comment, reply_time = excluded.reply_time,
         draft_status = CASE WHEN excluded.reply_comment IS NOT NULL AND excluded.reply_comment != '' THEN 'posted' ELSE reviews.draft_status END,
         fetched_at = datetime('now')`,
      g.reviewId, l.id, g.reviewer?.isAnonymous ? 'Anonymous' : (g.reviewer?.displayName ?? 'A customer'), rating, g.comment ?? '',
      g.createTime ?? null, g.updateTime ?? null, replyComment, g.reviewReply?.updateTime ?? null, replyComment ? 'posted' : 'none'
    );
    if (changed) {
      run(`UPDATE reviews SET draft_status = 'none', draft_reply = NULL, draft_error = NULL WHERE id = ?`, g.reviewId);
      log('reviews', 'ok', `${g.reviewId}: the review was edited, so its drafted reply was discarded`, l.id);
      continue;
    }
    if (!existing) {
      try {
        await alertBadReview(l, {
          id: g.reviewId, rating, reviewer: g.reviewer?.isAnonymous ? 'Anonymous' : (g.reviewer?.displayName ?? 'A customer'),
          comment: g.comment ?? '', createTime: g.createTime ?? null,
        });
      } catch (e: any) { log('alert', 'error', e.message, l.id); }
    }
    // 'failed' covers two things: the draft could not be written (no draft text), which is tried
    // again on every check, or the reply could not be sent (draft text kept), which is sent again
    // only in automatic mode. Before this a review that met the AI on a bad minute was never answered.
    const undrafted = !existing || existing.draft_status === 'none' || (existing.draft_status === 'failed' && !(existing.draft_reply ?? '').trim());
    const unsent = existing?.draft_status === 'failed' && Boolean((existing.draft_reply ?? '').trim());
    // Automatic replies, except 1 and 2 star reviews when the business holds those for a person,
    // and except reviews too old to count as new.
    const auto = Boolean(l.auto_reply) && !(Boolean(l.hold_low_stars) && rating <= 2) && fresh(g.createTime);
    if (!replyComment && (undrafted || (unsent && auto))) {
      if (undrafted) newUnreplied++;
      try {
        if (undrafted) await draft(g.reviewId);
        // The list this review came from was read from Google a moment ago, so it is known to have no reply.
        if (auto) { await post(g.reviewId, { justRead: true }); posted++; }
      } catch (e: any) {
        run(`UPDATE reviews SET draft_status = 'failed', draft_error = ? WHERE id = ?`, e.message, g.reviewId);
        log('reviews', 'error', `${g.reviewId}: ${e.message}`, l.id);
      }
    }
  }
  run(`UPDATE locations SET last_review_poll = datetime('now') WHERE id = ?`, l.id);
  log('reviews', 'ok', `${gs.length} fetched, ${newUnreplied} new unreplied, ${posted} auto-posted`, l.id);
  return { fetched: gs.length, newUnreplied, posted };
}

function replySystem(l: LocationRow): string {
  const v = view(l);
  const services = [...new Set([...v.offeredServices, ...v.serviceNames])].slice(0, 20).join(', ');
  return `You write review replies for ${v.title}, a ${v.primaryCategory?.displayName ?? 'local business'} in ${v.town || 'the local area'}.
Voice: ${v.brand_voice || 'warm, plain, professional British English. Sound like the owner, not a call centre.'}
Rules:
- 1 to 3 sentences. Never more than 60 words. No emojis, no hashtags, no links, no phone numbers.
- Thank them by first name if given. Echo the specific service and the town naturally ONCE (e.g. "the kitchen rewire in St Albans"), because the reply text is indexed. Never list services, never keyword-stuff.
- 4 or 5 stars: thank, echo the service and town, invite them back or to recommend.
- 3 stars: thank, acknowledge the point, say what you will do.
- 1 or 2 stars: apologise once without excuses, do not argue or repeat the complaint, ask them to contact the owner directly to put it right. Stay calm and short.
- Empty review text: one sentence of thanks mentioning the town.
Known services: ${services || 'general'}.
Return only the reply text.`;
}

export async function draft(reviewId: string): Promise<string> {
  const r = review(reviewId);
  if (!r) throw new Error('Unknown review');
  const l = location(r.location_id)!;
  const user = `Reviewer: ${r.reviewer}\nStars: ${r.rating}\nReview: ${r.comment?.trim() || '(no text, rating only)'}`;
  const reply = (await llmText(replySystem(l), user)).replace(/^["']|["']$/g, '').trim();
  run(`UPDATE reviews SET draft_reply = ?, draft_status = 'draft', draft_error = NULL WHERE id = ?`, reply, reviewId);
  return reply;
}

export function setDraft(reviewId: string, reply: string) {
  run(`UPDATE reviews SET draft_reply = ?, draft_status = 'draft' WHERE id = ?`, reply, reviewId);
}
export function skip(reviewId: string) {
  run(`UPDATE reviews SET draft_status = 'skipped' WHERE id = ?`, reviewId);
}

/**
 * Send the drafted reply. Google keeps one reply per review and a second one REPLACES it, so unless
 * the caller has just read the review from Google (`justRead`), it is read again first: the owner
 * may have answered on Google themselves since the last check, and their words are not ours to
 * overwrite.
 */
export async function post(reviewId: string, opts: { justRead?: boolean } = {}): Promise<void> {
  const r = review(reviewId);
  if (!r) throw new Error('Unknown review');
  if (r.reply_comment) throw new Error('This review already has a reply on Google.');
  const reply = (r.draft_reply ?? '').trim();
  if (!reply) throw new Error('No draft to post');
  const l = location(r.location_id)!;
  if (!opts.justRead) {
    const now = await getReview(l.account, l.id, r.id);
    const theirs = now?.reviewReply?.comment?.trim();
    if (theirs) {
      run(`UPDATE reviews SET reply_comment = ?, reply_time = ?, draft_status = 'posted', draft_error = NULL WHERE id = ?`, theirs, now?.reviewReply?.updateTime ?? null, reviewId);
      log('reply', 'ok', `${r.rating}★ ${r.reviewer}: already answered on Google, nothing sent`, l.id);
      throw new Error('This review was already answered on Google, so nothing was sent. The reply there has been kept.');
    }
  }
  try {
    await replyToReview(l.account, l.id, r.id, reply);
    run(`UPDATE reviews SET reply_comment = ?, reply_time = datetime('now'), draft_status = 'posted', draft_error = NULL WHERE id = ?`, reply, reviewId);
    log('reply', 'ok', `${r.rating}★ ${r.reviewer}`, l.id);
  } catch (e: any) {
    run(`UPDATE reviews SET draft_status = 'failed', draft_error = ? WHERE id = ?`, e.message, reviewId);
    log('reply', 'error', e.message, l.id);
    throw e;
  }
}

/**
 * Post every drafted reply for a business in one go, for clearing a backlog. Replies to 1 and 2 star
 * reviews are never included: those are approved one by one.
 */
export async function postAll(locationId: string): Promise<{ posted: number; failed: number; held: number }> {
  // Read the reviews from Google first. The drafts were written at the last check, up to an hour
  // ago; since then a customer may have edited a review or the owner may have replied on Google,
  // and this button sends many replies with nobody reading each one. If Google cannot be read,
  // nothing is sent. Only drafts that were on the page when the button was pressed go out: one
  // written during this very check has not been seen by anybody yet.
  const waiting = (rs: ReviewRow[]) => rs.filter(r => r.draft_status === 'draft' && !r.reply_comment && (r.draft_reply ?? '').trim());
  const shown = new Map(waiting(reviews(locationId)).map(r => [r.id, r.draft_reply]));
  await poll(locationId);
  const drafts = waiting(reviews(locationId)).filter(r => shown.get(r.id) === r.draft_reply);
  const held = drafts.filter(r => r.rating <= 2).length;
  let posted = 0, failed = 0;
  for (const r of drafts.filter(r => r.rating > 2)) {
    try { await post(r.id, { justRead: true }); posted++; } catch { failed++; }
  }
  log('reply', failed ? 'error' : 'ok', `Posted ${posted} drafted replies at once${failed ? `, ${failed} failed` : ''}${held ? `; ${held} to 1 and 2 star reviews left for approval` : ''}`, locationId);
  return { posted, failed, held };
}
