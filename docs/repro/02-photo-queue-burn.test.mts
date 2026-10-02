// One refused photo should not use up the whole photo queue, one photo every five minutes.
import assert from 'node:assert/strict';
import { sandbox, repro, json } from './_harness.mts';

await repro('photo queue: a failure does not burn through the queue', async () => {
  const s = await sandbox({ llm: () => 'x' });
  await s.connectGoogle();
  await s.linkedLocation();
  const { run, all } = await s.lib('db');
  const { enqueuePhotos } = await s.lib('extras');
  enqueuePhotos('locations/1', 'https://example.com/1.jpg\nhttps://example.com/2.jpg\nhttps://example.com/3.jpg');
  run(`UPDATE locations SET last_review_poll = datetime('now'), metrics_synced_at = ?, photos_synced_at = datetime('now')`, new Date().toISOString());
  // Google is having a bad quarter of an hour.
  s.route(/mybusiness\.googleapis\.com\/v4\/.*\/media/, () => json({ error: { message: 'Internal error encountered.' } }, 500));

  const { tick } = await s.lib('scheduler');
  for (let i = 0; i < 3; i++) await tick();

  const rows = all('SELECT status FROM photo_queue ORDER BY id').map((r: any) => r.status);
  assert.ok(rows.filter((x: string) => x === 'failed').length <= 1, `after 3 ticks the queue reads: ${rows.join(', ')} (photos are meant to go out one every 14 days)`);
});
