// Disconnect the first Google account while a second stays connected: at the next start of the app the first
// account is back, with the token that was just revoked, and a sync fails for every account.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { sandbox, repro, json } from './_harness.mts';

if (process.argv[2] === 'second-start') {
  // A fresh process over the same database: what a restart of the app does.
  process.chdir(process.argv[3]);
  const { pathToFileURL } = await import('node:url');
  await import(pathToFileURL(path.resolve(import.meta.dirname, '..', '..', 'src', 'lib', 'db.ts')).href);
  process.exit(0);
}

await repro('Google logins: a disconnected account stays disconnected', async () => {
  const s = await sandbox();
  const { run } = await s.lib('db');
  // A database from before several logins were supported has its one login in google_connection too.
  run(`INSERT INTO google_connection (id, email, refresh_token) VALUES (1, 'first@example.com', 'rt-first')`);
  run(`INSERT INTO google_logins (login, name, refresh_token) VALUES ('first@example.com', 'first@example.com', 'rt-first'), ('second@example.com', 'second@example.com', 'rt-second')`);
  s.route(/oauth2\.googleapis\.com\/revoke/, () => json({}));
  const { disconnect } = await s.lib('gauth');
  disconnect('first@example.com');

  const child = spawnSync(process.execPath, [...process.execArgv, import.meta.filename, 'second-start', s.dir], { encoding: 'utf8' });
  if (child.status !== 0) throw new Error(`second start failed: ${child.stderr}`);
  const logins = (new DatabaseSync(path.join(s.dir, 'data', 'gbp.db')).prepare('SELECT login FROM google_logins ORDER BY login').all() as any[]).map(r => r.login);
  assert.deepEqual(logins, ['second@example.com'], `logins after a restart: ${logins.join(', ')}`);
});
