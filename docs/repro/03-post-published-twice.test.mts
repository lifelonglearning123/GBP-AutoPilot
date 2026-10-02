// Two presses of Publish that overlap (two tabs, a double click, the scheduler and a person) create two posts on Google.
import assert from 'node:assert/strict';
import { sandbox, repro, json } from './_harness.mts';

await repro('posts.publish: overlapping calls send one post', async () => {
  const s = await sandbox();
  await s.connectGoogle();
  await s.linkedLocation();
  const { run } = await s.lib('db');
  run(`INSERT INTO posts (location_id, summary) VALUES ('locations/1', 'Hello St Albans')`);
  s.route(/localPosts/, async () => { await new Promise(r => setTimeout(r, 100)); return json({ name: 'accounts/1/locations/1/localPosts/9' }); });

  const { publish } = await s.lib('posts');
  await Promise.allSettled([publish(1), publish(1)]);
  const sent = s.calls.filter(c => /localPosts/.test(c.url) && c.method === 'POST').length;
  assert.equal(sent, 1, `Google received ${sent} create-post calls for one draft`);
});
