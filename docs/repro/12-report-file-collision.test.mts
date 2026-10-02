// Two businesses with the same name share one report file, so the first one's "Report" link shows the second one's report.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sandbox, repro } from './_harness.mts';

await repro('reports: each business has its own file', async () => {
  const s = await sandbox({ mock: true, llm: () => ({ headline: 'h', findings: [], actions: [] }) });
  const { saveManual, location } = await s.lib('locations');
  const a = saveManual({ title: 'Smith Plumbing', street: '1 High St', town: 'Swindon', postcode: 'SN1 1AA', phone: '01793 111111' });
  const b = saveManual({ title: 'Smith Plumbing', street: '9 Low Rd', town: 'Bath', postcode: 'BA1 1AA', phone: '01225 222222' });
  const report = await s.lib('report');
  await report.build(a.id);
  await report.build(b.id);
  const fileA = location(a.id).report_url, fileB = location(b.id).report_url;
  const html = fs.readFileSync(fileA, 'utf8');
  assert.ok(fileA !== fileB && html.includes('01793 111111'),
    `both businesses point at ${fileA.split(/[\\/]/).pop()}; the Swindon business's report now shows ${html.includes('01225 222222') ? 'the Bath business (01225 222222)' : 'something else'}`);
});
