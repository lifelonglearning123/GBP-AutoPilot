// The scheduler reads every business once at the start of a tick and acts on that copy. Switch a business's
// weekly post off while the tick is still busy with another business, and the post goes out anyway, and the
// schedule that was just switched off is switched back on.
import assert from 'node:assert/strict';
import { sandbox, repro, json } from './_harness.mts';

await repro('scheduler: a setting switched off during a tick is respected', async () => {
  let switchedOff = false;
  const s = await sandbox({
    llm: () => {
      // The person presses Save on Bravo's Settings tab while the tick is writing Alpha's post.
      if (!switchedOff) { switchedOff = true; off(); }
      return { summary: 'A weekly post.', cta: 'CALL' };
    },
  });
  await s.connectGoogle();
  await s.linkedLocation({ name: 'locations/1', title: 'Alpha Electrical' });
  await s.linkedLocation({ name: 'locations/2', title: 'Bravo Plumbing' });
  const { run, all } = await s.lib('db');
  const { updateConfig } = await s.lib('locations');
  const off = () => updateConfig('locations/2', { auto_post: 0, next_post_at: null });
  run(`UPDATE locations SET auto_post = 1, next_post_at = ?, last_review_poll = datetime('now'), metrics_synced_at = ?, photos_synced_at = datetime('now')`,
    new Date(Date.now() - 60_000).toISOString(), new Date().toISOString());
  s.route(/localPosts/, () => json({ name: 'x/localPosts/1' }));

  const { tick } = await s.lib('scheduler');
  await tick();
  const sentForBravo = s.calls.filter(c => /locations\/2\/localPosts/.test(c.url)).length;
  const bravo = all(`SELECT auto_post, next_post_at FROM locations WHERE id = 'locations/2'`)[0];
  assert.ok(sentForBravo === 0 && bravo.next_post_at === null,
    `Bravo's weekly post was switched off mid-tick; ${sentForBravo} post went to its Google profile and its schedule reads ${bravo.next_post_at ? `on again (${bravo.next_post_at})` : 'off'}`);
});
