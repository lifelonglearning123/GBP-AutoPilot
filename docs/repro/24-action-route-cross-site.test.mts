// Bug 7, checked against the route itself: a cross-site or non-JSON request is refused before anything runs.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sandbox, repro } from './_harness.mts';

await repro('action route: only this app\'s own pages may call it', async () => {
  const s = await sandbox({ mock: true });
  const { syncAll, location } = await s.lib('locations');
  await syncAll();
  const id = 'locations/200000000000000001';
  const route = await import(pathToFileURL(path.resolve(import.meta.dirname, '..', '..', 'src', 'app', 'api', 'action', 'route.ts')).href);
  const POST = route.POST ?? route.default?.POST;
  const body = JSON.stringify({ action: 'location.config', id, config: { auto_reply: 1, hold_low_stars: 0 } });
  const send = (headers: Record<string, string>) => POST(new Request('http://localhost:3320/api/action', { method: 'POST', headers: { host: 'localhost:3320', ...headers }, body }));

  const before = location(id).auto_reply;
  assert.equal((await send({ 'content-type': 'text/plain', origin: 'https://evil.example' })).status, 403, 'a text/plain post from another site');
  assert.equal((await send({ 'content-type': 'application/json', origin: 'https://evil.example' })).status, 403, 'a JSON post from another site');
  assert.equal((await send({ 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' })).status, 403, 'a post the browser marks cross-site');
  assert.equal((await send({ 'content-type': 'text/plain' })).status, 403, 'a post that is not JSON');
  assert.equal(location(id).auto_reply, before, 'none of the refused requests changed the setting');
  const own = await send({ 'content-type': 'application/json', origin: 'http://localhost:3320' });
  assert.equal(own.status, 200, `the app's own page was refused: ${await own.clone().text()}`);
  assert.equal(location(id).auto_reply, 1, 'and that one is carried out');
  assert.equal((await send({ 'content-type': 'application/json' })).status, 200, 'the scheduler\'s own knock, which sends no Origin');
});
