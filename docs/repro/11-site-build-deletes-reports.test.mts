// "Folder name for the pages" is used as a path and emptied before each build. A name that is already a folder
// under output/ is wiped: here, every client report. ("..", not tried here, points the delete at the app folder.)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, repro } from './_harness.mts';

await repro('site build: only ever deletes its own folder', async () => {
  const s = await sandbox({ mock: true });
  const { syncAll, updateConfig } = await s.lib('locations');
  await syncAll();
  const id = 'locations/200000000000000001';
  const { run } = await s.lib('db');
  const report = path.join(process.cwd(), 'output', 'reports', 'another-client-2026-10-01.html');
  fs.mkdirSync(path.dirname(report), { recursive: true });
  fs.writeFileSync(report, '<h1>report</h1>');
  run(`INSERT INTO site_pages (location_id, kind, slug, title, content_json) VALUES (?, 'home', 'index', 'Home', '{}')`, id);

  updateConfig(id, { site_slug: 'reports' });            // what Settings > "Folder name for the pages" saves
  const site = await s.lib('site');
  try { site.build(id); } catch { /* refusing would be the right answer */ }
  assert.ok(fs.existsSync(report), 'output/reports/another-client-2026-10-01.html was deleted by building a website');
});
