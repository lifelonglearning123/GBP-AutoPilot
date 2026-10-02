// (a) A customer edits their review; the reply drafted for the old wording stays "ready" and "Post all" sends it.
// (b) A reply that could not be drafted once (AI down for a minute) is never drafted again.
// (c) "Post all" overwrites a reply the owner wrote on Google since the last check.
import assert from 'node:assert/strict';
import { sandbox, repro, json } from './_harness.mts';

await repro('review replies: drafts follow the review', async () => {
  let llmUp = true;
  const s = await sandbox({ llm: (_s, user) => { if (!llmUp) throw new Error('model overloaded'); return /Great job/.test(user) ? 'So glad you loved the rewire!' : 'Reply to: ' + user.slice(-40); } });
  await s.connectGoogle();
  const l = await s.linkedLocation();
  const { all } = await s.lib('db');
  const reviews = await s.lib('reviews');
  const problems: string[] = [];
  let list: any[] = [];
  s.route(/\/reviews\?/, () => json({ reviews: list }));
  s.route(/\/reviews\/[^/]+\/reply/, () => json({}));

  // (a)
  list = [{ reviewId: 'a', reviewer: { displayName: 'Sam' }, starRating: 'FIVE', comment: 'Great job on the rewire', createTime: new Date().toISOString(), updateTime: new Date().toISOString() }];
  await reviews.poll(l.id);
  list = [{ ...list[0], starRating: 'THREE', comment: 'Edit: the sockets stopped working a week later and nobody came back.' }];
  await reviews.poll(l.id);
  const a = all(`SELECT draft_status, draft_reply FROM reviews WHERE id = 'a'`)[0];
  await reviews.postAll(l.id);
  const sent = s.calls.find(c => /reviews\/a\/reply/.test(c.url));
  if (sent) problems.push(`(a) the review now reads "the sockets stopped working"; the reply posted to Google was "${sent.body.comment}"`);

  // (b)
  llmUp = false;
  list = [{ reviewId: 'b', reviewer: { displayName: 'Jo' }, starRating: 'FIVE', comment: 'Quick and tidy', createTime: new Date().toISOString(), updateTime: new Date().toISOString() }];
  await reviews.poll(l.id);
  llmUp = true;
  await reviews.poll(l.id);
  await reviews.poll(l.id);
  const b = all(`SELECT draft_status, draft_reply FROM reviews WHERE id = 'b'`)[0];
  if (b.draft_status === 'failed') problems.push('(b) two checks after the AI came back, the review still has no draft (status "failed"), so with automatic replies on it is never answered');

  // (c)
  list = [{ reviewId: 'c', reviewer: { displayName: 'Al' }, starRating: 'FOUR', comment: 'Good', createTime: new Date().toISOString(), updateTime: new Date().toISOString() }];
  await reviews.poll(l.id);                       // drafted, waiting for approval
  list = [{ ...list[0], reviewReply: { comment: 'Thanks Al, Dan here. See you in spring for the garage.', updateTime: new Date().toISOString() } }];   // the owner replies on Google
  const before = s.calls.length;
  await reviews.postAll(l.id);                    // pressed before the next hourly check
  const over = s.calls.slice(before).find(c => /reviews\/c\/reply/.test(c.url) && c.method === 'PUT');
  if (over) problems.push(`(c) the owner's own reply on Google was replaced with the AI draft "${over.body.comment}"`);

  assert.deepEqual(problems, []);
});
