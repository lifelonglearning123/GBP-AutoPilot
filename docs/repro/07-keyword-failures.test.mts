// (a) Every search failing stores a run with a share of 0% and puts the next check a week away.
// (b) A failed AI intent check is stored as the permanent verdict "ok".
// Takes about 10 seconds (the app's own retries).
import assert from 'node:assert/strict';
import { sandbox, repro, json } from './_harness.mts';

await repro('searches: failures are not stored as results', async () => {
  const s = await sandbox({ serper: true, llm: () => { throw new Error('model overloaded'); } });
  const l = await s.linkedLocation();
  const { run, all } = await s.lib('db');
  run(`INSERT INTO keywords (location_id, phrase) VALUES (?, 'electrician in St Albans')`, l.id);
  const kw = await s.lib('keywords');
  const problems: string[] = [];

  // (a) Serper is down.
  s.route(/google\.serper\.dev\/places/, () => json({ message: 'Not enough credits' }, 400));
  await kw.runKeywords(l.id).catch(() => null);
  const runs = all('SELECT visibility FROM keyword_runs');
  const next = all('SELECT next_keywords_at FROM locations')[0].next_keywords_at;
  if (runs.length) problems.push(`(a) with every search failing, a run was stored with share ${runs[0].visibility}% and the next check ${next ? 'moved a week out' : 'left due'}`);

  // (b) Serper is back, the model is not. The business is not in the results, so intent has to be judged.
  const places = Array.from({ length: 10 }, (_, i) => ({ cid: String(1000 + i), title: `Charging Station ${i}`, address: 'St Albans', category: 'EV charging station', rating: 4, ratingCount: 10 }));
  s.route(/google\.serper\.dev\/places/, c => json({ places: c.body.page === 1 ? places : [] }));
  s.route(/google\.serper\.dev\/maps/, () => json({ places: [] }));
  await kw.runKeywords(l.id).catch(() => null);
  const intent = all('SELECT intent FROM keywords')[0].intent;
  if (intent === 'ok') problems.push('(b) the intent check failed, and the search was stored as judged "ok" for good');

  assert.deepEqual(problems, []);
});
