// A map where every point failed (Serper out of credits) finishes "done" and tells the client they are not found anywhere.
// Takes about 25 seconds: each point is retried twice with the app's own back-off.
import assert from 'node:assert/strict';
import { sandbox, repro, json } from './_harness.mts';

await repro('map grid: failed reads are never reported as "not found"', async () => {
  const s = await sandbox({ serper: true });
  await s.linkedLocation({ latlng: { latitude: 51.7497, longitude: -0.3387 } });
  const { run, all } = await s.lib('db');
  run(`INSERT INTO keywords (location_id, phrase) VALUES ('locations/1', 'electrician in St Albans')`);
  s.route(/google\.serper\.dev\/maps/, () => json({ message: 'Not enough credits', statusCode: 400 }, 400));

  const grid = await s.lib('grid');
  const { runId } = grid.startGrid('locations/1', { size: 3, radiusMi: 1, keywordIds: [1] });
  while (grid.isRunning(runId)) await new Promise(r => setTimeout(r, 500));

  const r = all('SELECT status, visibility, error FROM grid_runs WHERE id = ?', runId)[0];
  const done = grid.latestDoneGrid('locations/1');
  const line = done ? grid.sidesLine(grid.gridSummary(done).keywords[0], done.radius_mi) : '';
  const l = all('SELECT next_grid_at FROM locations')[0];
  assert.ok(r.status !== 'done' && !/Not in the first 20/.test(line),
    `run status "${r.status}", share stored as ${r.visibility}%, next re-map ${l.next_grid_at ? 'pushed a month out' : 'not set'}.\nThe page and the client report say: "${line}"`);
});
