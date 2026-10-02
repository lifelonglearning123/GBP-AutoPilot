// A linked business with more than 200 reviews is scored, and reported, as having 200.
import assert from 'node:assert/strict';
import { sandbox, repro, json } from './_harness.mts';

await repro('reviews: the count is Google\'s total, not the number of rows read', async () => {
  const s = await sandbox({ llm: () => 'Thanks.' });
  await s.connectGoogle();
  const l = await s.linkedLocation();
  const all250 = Array.from({ length: 250 }, (_, i) => ({
    reviewId: `r${i}`, reviewer: { displayName: `Customer ${i}` }, starRating: i < 200 ? 'FIVE' : 'ONE', comment: 'x',
    createTime: '2025-01-01T00:00:00Z', updateTime: '2025-01-01T00:00:00Z', reviewReply: { comment: 'Thanks', updateTime: '2025-01-02T00:00:00Z' },
  }));
  s.route(/\/reviews\?/, c => {
    const start = Number(new URL(c.url).searchParams.get('pageToken') ?? 0);
    const page = all250.slice(start, start + 50);
    // The real API sends these two with every page; the app never reads them.
    return json({ reviews: page, averageRating: 4.2, totalReviewCount: 250, nextPageToken: start + 50 < 250 ? String(start + 50) : undefined });
  });
  const { poll } = await s.lib('reviews');
  await poll(l.id);
  const { audit } = await s.lib('audit');
  const { location } = await s.lib('locations');
  const items = audit(location(l.id)).items;
  const count = items.find((i: any) => i.key === 'review_count').note, rating = items.find((i: any) => i.key === 'rating').note;
  assert.ok(/^250 reviews/.test(count) && /^4\.2/.test(rating), `Google says 250 reviews averaging 4.2. The audit says: "${count}" and "${rating}"`);
});
