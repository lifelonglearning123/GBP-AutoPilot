// A failed second page is cached for a day as if Google showed only ten businesses, so 11th to 20th reads "not in the first 20".
import assert from 'node:assert/strict';
import { sandbox, repro, json } from './_harness.mts';

await repro('competitor search: a failed page is not cached as the whole market', async () => {
  const s = await sandbox({ serper: true });
  const page = (n: number) => Array.from({ length: 10 }, (_, i) => ({ cid: String(n * 100 + i), title: `Business ${n}-${i}`, address: 'St Albans', ratingCount: 5 }));
  let page2Up = false;
  s.route(/google\.serper\.dev\/places/, c => c.body.page === 1 ? json({ places: page(1) }) : page2Up ? json({ places: page(2) }) : json({ message: 'Scraping failed' }));

  const { searchMarket } = await s.lib('benchmark');
  const first = await searchMarket('electrician in St Albans');
  page2Up = true;
  const second = await searchMarket('electrician in St Albans');
  assert.equal(second.length, 20, `first call returned ${first.length} businesses; a minute later, with Serper working, the cached answer still has ${second.length}`);
});
