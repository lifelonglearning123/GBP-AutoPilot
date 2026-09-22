import { all, one, run, log } from './db';
import { text as llmText } from './llm';
import { location, view, type LocationRow } from './locations';
import { listReviews, replyToReview, STARS } from './gbp';

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
 * Pull reviews, store new ones, draft replies for anything unanswered, and post the drafts
 * straight away when the location is on auto-reply.
 */
export async function poll(locationId: string): Promise<{ fetched: number; newUnreplied: number; posted: number }> {
  const l = location(locationId);
  if (!l) throw new Error('Unknown location');
  const gs = await listReviews(l.account, l.id);
  let newUnreplied = 0, posted = 0;

  for (const g of gs) {
    const existing = review(g.reviewId);
    const rating = STARS[g.starRating ?? ''] ?? 0;
    const replyComment = g.reviewReply?.comment ?? null;
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
    if (!replyComment && (!existing || existing.draft_status === 'none')) {
      newUnreplied++;
      try {
        await draft(g.reviewId);
        if (l.auto_reply) { await post(g.reviewId); posted++; }
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

export async function post(reviewId: string): Promise<void> {
  const r = review(reviewId);
  if (!r) throw new Error('Unknown review');
  const reply = (r.draft_reply ?? '').trim();
  if (!reply) throw new Error('No draft to post');
  const l = location(r.location_id)!;
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
