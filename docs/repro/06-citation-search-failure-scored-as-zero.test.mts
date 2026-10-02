// When every Serper search fails, the audit records "0 listings found" and the business loses all 15 consistency points.
import assert from 'node:assert/strict';
import { sandbox, repro, json } from './_harness.mts';

await repro('citation audit: a search outage is not recorded as "no listings"', async () => {
  const s = await sandbox({ serper: true });
  const l = await s.linkedLocation();
  s.route(/google\.serper\.dev\/search/, () => json({ message: 'Not enough credits', statusCode: 400 }, 400));

  const citations = await s.lib('citations');
  let threw = false;
  await citations.audit(l.id).catch(() => { threw = true; });
  const { audit } = await s.lib('audit');
  const { location } = await s.lib('locations');
  const nap = audit(location(l.id)).items.find((i: any) => i.key === 'nap');
  const last = citations.latestRun(l.id);
  const missing = last ? citations.missingDirectories(last.id).length : 0;
  assert.ok(threw || nap.unknown,
    `the check is scored ${nap.points * nap.weight} of ${nap.weight} with the note "${nap.note}", and ${missing} directories are listed as "Not listed on"`);
});
