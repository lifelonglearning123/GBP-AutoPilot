// Pure-function edge cases in nap.ts, grid.ts and benchmark.ts.
import assert from 'node:assert/strict';
import { sandbox, repro } from './_harness.mts';

await repro('matching: UK phone, postcode and name edge cases', async () => {
  const s = await sandbox();
  const nap = await s.lib('nap');
  const grid = await s.lib('grid');
  const bench = await s.lib('benchmark');
  const problems: string[] = [];

  // UK numbers with nine digits after the 0 (0800 xxxxxx, 01204 xxxxx, 016977 xxxx) written with +44.
  for (const [a, b] of [['+44 800 800150', '0800 800150'], ['+44 1204 62345', '01204 62345'], ['+44 16977 3555', '016977 3555']]) {
    if (nap.normPhone(a) !== nap.normPhone(b)) problems.push(`phone: "${a}" (${nap.normPhone(a)}) is not matched to "${b}" (${nap.normPhone(b)})`);
  }
  // An address with "1st floor" or "2nd floor" before the real postcode.
  const pc = nap.POSTCODE_RE.exec('Suite W1 1st Floor, 10 High Street, London EC1A 1BB')?.[0];
  if (nap.normPostcode(pc ?? '') !== 'EC1A1BB') problems.push(`postcode: read "${pc}" from "Suite W1 1st Floor, 10 High Street, London EC1A 1BB"`);
  // Towns that are also words: the product is removed instead of the town.
  const q = grid.phoneQuery('bath resurfacing in Bath', 'Bath');
  if (q !== 'bath resurfacing') problems.push(`map wording: "bath resurfacing in Bath" is searched as "${q}"`);
  // Names with no Latin letters all normalise to the empty string, so any two of them "match".
  const l: any = { title: 'Суши Дом', phone: null, public_cid: null, address_json: JSON.stringify({ locality: 'Leeds' }), categories_json: null, services_json: null, hours_json: null, latlng_json: null, offered_services: null, service_areas: null, language_code: 'en-GB' };
  if (bench.isSelf({ cid: '9', title: '北京饭店', address: '1 The Headrow, Leeds LS1 1AA' }, l)) problems.push('self-match: "北京饭店" is taken to be the business "Суши Дом"');

  assert.deepEqual(problems, []);
});
