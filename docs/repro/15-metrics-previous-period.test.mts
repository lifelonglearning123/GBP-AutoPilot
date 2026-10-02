// "28-day views, with the change on the previous 28 days": the previous period is 29 days, so growth is understated.
import assert from 'node:assert/strict';
import { sandbox, repro } from './_harness.mts';

await repro('performance stats: both periods are 28 days', async () => {
  const s = await sandbox({ mock: true });
  const { syncAll } = await s.lib('locations');
  await syncAll();
  const id = 'locations/200000000000000001';
  const { run, all } = await s.lib('db');
  const extras = await s.lib('extras');
  await extras.syncMetrics(id);
  // Make every day worth exactly 10 calls, so the totals show how many days each period holds.
  run(`UPDATE metrics SET value = CASE WHEN metric = 'CALL_CLICKS' THEN 10 ELSE 0 END`);
  const calls = extras.summary(id).find((g: any) => g.key === 'calls');
  assert.equal(calls.prev28, calls.last28, `at 10 calls a day: last 28 days = ${calls.last28}, "previous 28 days" = ${calls.prev28} (${calls.prev28 / 10} days). A flat month reads as a ${Math.round((1 - calls.last28 / calls.prev28) * 100)}% fall.`);
});
