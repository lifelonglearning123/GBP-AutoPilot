// "Reply to new reviews automatically" switched on before a business's first review check (a newly synced or newly
// linked profile) replies to every unanswered review Google returns, however old, in one go.
// Alerts already guard against this with a 14-day limit (alerts.ts); replies have none.
import assert from 'node:assert/strict';
import { sandbox, repro, json } from './_harness.mts';

await repro('automatic replies: only new reviews are answered without a person', async () => {
  const s = await sandbox({ llm: () => 'Thank you for your review.' });
  await s.connectGoogle();
  const l = await s.linkedLocation();
  const { updateConfig } = await s.lib('locations');
  updateConfig(l.id, { auto_reply: 1 });
  const old = (id: string, year: number) => ({ reviewId: id, reviewer: { displayName: 'Old Customer' }, starRating: 'FIVE', comment: 'Good', createTime: `${year}-03-01T10:00:00Z`, updateTime: `${year}-03-01T10:00:00Z` });
  s.route(/\/reviews\?/, () => json({ reviews: [old('a', 2019), old('b', 2020), old('c', 2021)] }));
  s.route(/\/reply/, () => json({}));

  const { poll } = await s.lib('reviews');
  await poll(l.id);
  const sent = s.calls.filter(c => /\/reply/.test(c.url)).length;
  assert.equal(sent, 0, `${sent} replies were posted to reviews written in 2019, 2020 and 2021`);
});
