// The monthly re-map guesses "keep the town" from the first point of the last map. When that search has no town
// in it, the guess is wrong and every other search is mapped with different wording, so it is no longer comparable.
import assert from 'node:assert/strict';
import { sandbox, repro, json } from './_harness.mts';

await repro('monthly re-map: repeats the wording of the last map', async () => {
  const s = await sandbox({ serper: true });
  await s.linkedLocation({ latlng: { latitude: 51.7497, longitude: -0.3387 } });
  const { run, all } = await s.lib('db');
  run(`INSERT INTO keywords (location_id, phrase) VALUES ('locations/1', 'boiler repair'), ('locations/1', 'plumber in St Albans')`);
  s.route(/serper\.dev\/maps/, () => json({ places: [{ cid: '5', title: 'Someone Else', address: 'St Albans AL1 1AA' }] }));

  const grid = await s.lib('grid');
  const wait = async (id: number) => { while (grid.isRunning(id)) await new Promise(r => setTimeout(r, 100)); };
  const first = grid.startGrid('locations/1', { size: 3, radiusMi: 1, keywordIds: [1, 2], withTown: false });
  await wait(first.runId);
  const again = grid.rerunLast('locations/1');
  await wait(again.runId);

  const q = (id: number) => all(`SELECT DISTINCT query FROM grid_points WHERE run_id = ? AND phrase = 'plumber in St Albans'`, id)[0].query;
  assert.equal(q(again.runId), q(first.runId), `first map searched "${q(first.runId)}", the automatic re-map searched "${q(again.runId)}"`);
});
