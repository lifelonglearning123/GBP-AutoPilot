// "Hour (local)" is the server's local hour. On a Linux host (UTC) a 9 o'clock post goes out at 10:00 UK time
// all summer, and the weekly score's "week" starts at 01:00 on Monday.
import assert from 'node:assert/strict';

process.env.TZ = 'UTC';                      // what a default Linux server or container runs in
const { sandbox, repro } = await import('./_harness.mts');

await repro('weekly post: the hour is UK time whatever the server clock', async () => {
  const s = await sandbox();
  const { nextPostAt } = await s.lib('posts');
  const l: any = { post_weekday: 1, post_hour: 9 };                       // Monday, 09:00
  const at = new Date(nextPostAt(l, new Date('2026-07-01T12:00:00Z')));   // British Summer Time
  const uk = at.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
  assert.equal(uk, '09:00', `a 09:00 Monday post is scheduled for ${uk} UK time (${at.toISOString()})`);
});
