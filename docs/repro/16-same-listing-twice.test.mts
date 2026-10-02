// The same Google listing added twice (two prospect searches of one town, or a prospect that is also hand-added):
// the reviews belong to whichever copy was read first, and the second copy scores differently.
// Also: every public listing is told its map pin was "placed by hand".
import assert from 'node:assert/strict';
import { sandbox, repro, json } from './_harness.mts';

await repro('public listing: the same listing reads the same twice', async () => {
  const s = await sandbox({ serper: true });
  s.route(/serper\.dev\/maps/, () => json({ places: [{ cid: '777', placeId: 'ChIJ777', title: 'Acme Plumbing', address: '1 High St, Swindon SN1 1AA', phoneNumber: '01793 000000', type: 'Plumber', rating: 4.8, ratingCount: 40, latitude: 51.56, longitude: -1.78 }] }));
  s.route(/serper\.dev\/reviews/, () => json({ reviews: Array.from({ length: 20 }, (_, i) => ({ id: `rev${i}`, rating: 5, snippet: 'Great', isoDate: new Date(Date.now() - i * 86_400_000).toISOString(), user: { name: `C${i}` }, response: i < 15 ? { snippet: 'Thanks' } : undefined })) }));

  const { saveManual, location } = await s.lib('locations');
  const pub = await s.lib('public');
  const { audit } = await s.lib('audit');
  const { all } = await s.lib('db');
  const a = saveManual({ title: 'Acme Plumbing', street: '', town: 'Swindon', postcode: 'SN1 1AA' });
  const b = saveManual({ title: 'Acme Plumbing', street: '', town: 'Swindon', postcode: 'SN1 1AA' });
  await pub.enrich(a.id, { cid: '777', matchedBy: 'prospect' });
  await pub.enrich(b.id, { cid: '777', matchedBy: 'prospect' });

  const n = (id: string) => all('SELECT COUNT(*) AS n FROM reviews WHERE location_id = ?', id)[0].n;
  const sa = audit(location(a.id)), sb = audit(location(b.id));
  const problems: string[] = [];
  if (n(a.id) !== n(b.id) || sa.score !== sb.score) problems.push(`two copies of one listing: ${n(a.id)} and ${n(b.id)} reviews stored, scores ${sa.score} and ${sb.score} (coverage ${sa.coverage}% and ${sb.coverage}%)`);
  const pin = sa.items.find((i: any) => i.key === 'latlng');
  if (/Placed by hand/.test(pin.note)) problems.push(`map pin: the coordinates came from Serper, and the check says "${pin.note}"`);
  assert.deepEqual(problems, []);
});
