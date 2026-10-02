// (a) A profile with no postcode (a service-area business) has every listing that shows one marked "Wrong details".
// (b) A listing that shows an old phone AND an old address is thrown away as search noise, and the directory is
//     then reported as "Not listed on".
import assert from 'node:assert/strict';
import { sandbox, repro } from './_harness.mts';

await repro('citation audit: no false mismatches, no dropped listings', async () => {
  // Mock mode with no Serper key reads the six fixture pages in src/lib/mock.ts instead of the web.
  const s = await sandbox({
    mock: true,
    llm: (_sys, user) => {
      const url = /Page: (\S+)/.exec(user)?.[1] ?? '';
      if (/thomsonlocal/.test(url)) return { relation: 'target', name: 'Bright Spark Electrical', phone: '01727 000000', address: '4 Market Place, St Albans AL3 5DG', notes: 'previous address' };
      return { relation: 'target', name: 'Bright Spark Electrical', phone: '01727 000000', address: '12 Holywell Hill, St Albans AL1 3AA', notes: '' };
    },
  });
  const { all } = await s.lib('db');
  const citations = await s.lib('citations');
  const problems: string[] = [];

  // (a) Same phone everywhere, but Google holds no postcode for this business.
  const a = await s.linkedLocation({ name: 'locations/1', storefrontAddress: { regionCode: 'GB', locality: 'St Albans' } });
  const ra = await citations.audit(a.id);
  if (ra.mismatches) {
    const why = all(`SELECT issues FROM citations WHERE run_id = ? AND status = 'mismatch'`, ra.id).map((r: any) => r.issues).join(' ');
    problems.push(`(a) ${ra.mismatches} of ${ra.found} listings marked "Wrong details" although the phone matches and the profile has no postcode to disagree with: ${why}`);
  }

  // (b) The business moved and changed its number; Thomson Local still shows the old address and the old number.
  const b = await s.linkedLocation({ name: 'locations/2', phoneNumbers: { primaryPhone: '01727 555555' }, storefrontAddress: { regionCode: 'GB', postalCode: 'AL4 9XX', locality: 'St Albans', addressLines: ['1 New Road'] } });
  const rb = await citations.audit(b.id);
  const rows = all('SELECT domain, status FROM citations WHERE run_id = ?', rb.id);
  if (!rows.some((r: any) => /thomsonlocal/.test(r.domain))) {
    problems.push(`(b) the Thomson Local page (old address, old phone) never reached the check: ${rows.length} rows stored, and "Not listed on" includes ${citations.missingDirectories(rb.id).map((d: any) => d.label).filter((x: string) => /Thomson|Yell|Cylex|Facebook/.test(x)).join(', ')}`);
  }

  assert.deepEqual(problems, []);
});
