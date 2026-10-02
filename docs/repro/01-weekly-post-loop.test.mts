// A weekly post that Google refuses is written again and sent again on every scheduler tick.
import assert from 'node:assert/strict';
import { sandbox, repro, json } from './_harness.mts';

await repro('weekly post: a failed publish does not repeat every tick', async () => {
  const s = await sandbox({ llm: () => ({ summary: 'A post about rewiring in St Albans.', cta: 'LEARN_MORE' }) });
  await s.connectGoogle();
  await s.linkedLocation();
  const { run, all } = await s.lib('db');
  const due = new Date(Date.now() - 60_000).toISOString();
  run(`UPDATE locations SET auto_post = 1, next_post_at = ?, last_review_poll = datetime('now'), metrics_synced_at = ?, photos_synced_at = datetime('now')`, due, new Date().toISOString());

  // Google refuses the post (a bad button link, a policy refusal, a 500: anything).
  s.route(/mybusiness\.googleapis\.com\/v4\/.*\/localPosts/, () => json({ error: { message: 'Request contains an invalid argument.' } }, 400));

  const { tick } = await s.lib('scheduler');
  for (let i = 0; i < 3; i++) await tick();          // three ticks = fifteen minutes of real time

  const posts = all('SELECT id, status FROM posts');
  const sent = s.calls.filter(c => /localPosts/.test(c.url) && c.method === 'POST').length;
  const next = all('SELECT next_post_at FROM locations')[0].next_post_at;
  assert.ok(posts.length <= 1 && sent <= 1 && next !== due,
    `after 3 ticks: ${posts.length} posts written (${posts.map((p: any) => p.status).join(', ')}), ${sent} sent to Google, ${s.llmCalls.length} AI calls, next_post_at ${next === due ? 'never moved on' : 'moved on'}`);
});
