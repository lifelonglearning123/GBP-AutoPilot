// Things already dealt with can be sent to Google again: a discarded post, a rejected draft, a posted photo.
import assert from 'node:assert/strict';
import { sandbox, repro } from './_harness.mts';

await repro('writes to Google check the row is still waiting', async () => {
  const s = await sandbox({ mock: true });
  const { syncAll } = await s.lib('locations');
  await syncAll();
  const id = 'locations/200000000000000001';
  const { run, all } = await s.lib('db');
  const problems: string[] = [];

  run(`INSERT INTO posts (location_id, summary, status) VALUES (?, 'Discarded draft', 'rejected')`, id);
  const posts = await s.lib('posts');
  await posts.publish(1).catch(() => null);
  if (all('SELECT status FROM posts')[0].status === 'posted') problems.push('a discarded post was published');

  run(`INSERT INTO suggestions (location_id, field, proposal_json, status) VALUES (?, 'description', '"Old draft text"', 'rejected')`, id);
  const suggest = await s.lib('suggest');
  await suggest.apply(1).catch(() => null);
  if (all('SELECT description FROM locations WHERE id = ?', id)[0].description === 'Old draft text') problems.push('a rejected description draft was written to the profile');

  run(`INSERT INTO photo_queue (location_id, url, status, posted_at) VALUES (?, 'https://example.com/a.jpg', 'posted', datetime('now'))`, id);
  const extras = await s.lib('extras');
  await extras.postPhoto(1).catch(() => null);
  const n = all(`SELECT COUNT(*) AS n FROM job_log WHERE job = 'photo' AND status = 'ok'`)[0].n;
  if (n > 0) problems.push('a photo already posted was uploaded again');

  assert.deepEqual(problems, []);
});
