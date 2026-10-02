// A prospect that was mid-audit when the app stopped stays "running" for ever: Continue skips it, Retry skips it.
import assert from 'node:assert/strict';
import { sandbox, repro } from './_harness.mts';

await repro('prospect batch: a restart does not strand a row', async () => {
  const s = await sandbox({ mock: true, llm: () => ({ relation: 'absent' }) });
  const { run, all } = await s.lib('db');
  const prospects = await s.lib('prospects');
  prospects.importCsv('batch', 'name,town,postcode\nAcme Plumbing,Swindon,SN1 1AA\nBest Roofing,Swindon,SN2 2BB', 10);
  // What the database holds after the server is stopped part-way through the first audit.
  run(`UPDATE prospects SET status = 'running' WHERE id = 1`);
  run(`UPDATE prospect_batches SET status = 'running' WHERE id = 1`);

  // Next start of the app: nothing is running in memory, so the page offers Continue and Retry.
  prospects.retryErrors(1);
  prospects.start(1);
  while (prospects.isRunning(1)) await new Promise(r => setTimeout(r, 100));
  const rows = all('SELECT title, status FROM prospects ORDER BY id').map((r: any) => `${r.title}: ${r.status}`);
  assert.ok(!rows[0].endsWith('running'), `after Continue and Retry: ${rows.join('; ')}`);
});
