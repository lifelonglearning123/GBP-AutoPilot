// Without an AI key the scheduler does nothing at all, including the jobs that never call the AI
// (performance stats, the photo check, the photo queue, weekly search checks, monthly maps).
import assert from 'node:assert/strict';
import { sandbox, repro } from './_harness.mts';

await repro('scheduler: jobs that need no AI still run without an AI key', async () => {
  const s = await sandbox({ mock: true });
  const { syncAll } = await s.lib('locations');
  await syncAll();
  delete process.env.OPENAI_API_KEY;
  const { tick } = await s.lib('scheduler');
  const out: string[] = await tick();
  assert.ok(out.some(x => /metrics synced/.test(x)), `the tick reported only: ${out.join(' | ')}`);
});
