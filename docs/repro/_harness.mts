/**
 * Shared set-up for the reproduction scripts in this folder (see docs/bug-review.md).
 *
 * Every script runs against a throwaway folder: the working directory is moved to a fresh temp
 * directory BEFORE any app module is loaded, because src/lib/db.ts opens `<cwd>/data/gbp.db` the
 * moment it is imported. Nothing here can touch the real database, Google, Serper or OpenAI:
 *  - global fetch is replaced; a URL with no route registered throws;
 *  - the OpenAI SDK is pointed at a local fake server through OPENAI_BASE_URL.
 *
 * Never import anything from src/lib with a static `import` in a script. Use `s.lib('name')`.
 *
 * Run one:   npx tsx docs/repro/01-weekly-post-loop.test.mts
 * Each script asserts the CORRECT behaviour, so it fails today and passes once the bug is fixed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const HERE = import.meta.dirname;
const LIB = path.resolve(HERE, '..', '..', 'src', 'lib');

export type Call = { url: string; method: string; body: any };
type Handler = (c: Call) => Response | Promise<Response> | unknown;

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export async function sandbox(opts: {
  mock?: boolean;
  serper?: boolean;
  /** Answers every LLM call. Return a string (the message content) or throw to make the call fail. */
  llm?: (system: string, user: string) => string | object;
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbp-repro-'));
  process.chdir(dir);
  if (fs.existsSync(path.join(process.cwd(), 'data', 'gbp.db'))) throw new Error('Refusing to run: this folder already has a database.');

  for (const k of Object.keys(process.env)) {
    if (/^(PIPEDREAM_|OPENROUTER_|GOOGLE_CLIENT|SERPER_|GBP_MOCK|OPENAI_|LLM_MODEL)/.test(k)) delete process.env[k];
  }
  if (opts.mock) process.env.GBP_MOCK = '1';
  if (opts.serper) process.env.SERPER_API_KEY = 'repro-key';

  const llmCalls: { system: string; user: string }[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', d => (raw += d));
    req.on('end', () => {
      const b = JSON.parse(raw || '{}');
      const system = String(b.messages?.[0]?.content ?? ''), user = String(b.messages?.[1]?.content ?? '');
      llmCalls.push({ system, user });
      try {
        if (!opts.llm) throw new Error('no LLM answer scripted');
        const out = opts.llm(system, user);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'x', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: typeof out === 'string' ? out : JSON.stringify(out) } }], usage: { total_tokens: 1 } }));
      } catch (e: any) {
        // 400, not 500: the SDK retries a 500 with back-off, which only slows the script down.
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: e.message } }));
      }
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as any).port;
  process.env.OPENAI_API_KEY = 'repro-key';
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;

  const routes: [RegExp, Handler][] = [];
  const calls: Call[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input?.url ?? input);
    if (url.startsWith('http://127.0.0.1:')) return realFetch(input, init);
    let body: any = init.body;
    try { body = typeof body === 'string' ? JSON.parse(body) : body; } catch { /* keep raw */ }
    const call: Call = { url, method: String(init.method ?? 'GET').toUpperCase(), body };
    calls.push(call);
    for (const [re, h] of routes) {
      if (re.test(url)) { const out = await h(call); return out instanceof Response ? out : json(out); }
    }
    throw new Error(`repro: unexpected network call ${call.method} ${url}`);
  }) as typeof fetch;

  const lib = async <T = any>(name: string): Promise<T> => {
    const m: any = await import(pathToFileURL(path.join(LIB, `${name}.ts`)).href);
    return { ...(m.default ?? {}), ...m } as T;
  };

  return {
    dir, calls, llmCalls, lib,
    route: (re: RegExp, h: Handler) => { routes.unshift([re, h]); },
    /** A connected Google login with a token that needs no refresh, so real (stubbed) Google calls run. */
    async connectGoogle() {
      const { run, setSetting } = await lib('db');
      run(`INSERT INTO google_logins (login, name, refresh_token, access_token, expires_at) VALUES ('a@example.com','a@example.com','rt','at', ?)`, Date.now() + 3_600_000);
      setSetting('google_account_logins', JSON.stringify({ 'accounts/1': 'a@example.com' }));
    },
    /** One linked business, as a sync would store it. */
    async linkedLocation(over: Record<string, any> = {}) {
      const { upsertFromGoogle, location } = await lib('locations');
      const g = {
        name: 'locations/1', title: 'Bright Spark Electrical', languageCode: 'en-GB',
        phoneNumbers: { primaryPhone: '01727 000000' }, websiteUri: 'https://brightspark.example',
        storefrontAddress: { regionCode: 'GB', postalCode: 'AL1 3AA', locality: 'St Albans', addressLines: ['12 Holywell Hill'] },
        categories: { primaryCategory: { name: 'categories/gcid:electrician', displayName: 'Electrician' } },
        metadata: { placeId: 'ChIJx', mapsUri: 'https://maps.google.com/?cid=111' },
        ...over,
      };
      upsertFromGoogle('accounts/1', g);
      return location(g.name);
    },
    close: () => { server.close(); globalThis.fetch = realFetch; },
  };
}

/** Run a script body, print a verdict, and exit non-zero while the bug is present. */
export async function repro(title: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`PASS  ${title}  (the bug is fixed)`);
    process.exit(0);
  } catch (e: any) {
    console.log(`FAIL  ${title}\n      ${String(e?.message ?? e).split('\n').join('\n      ')}`);
    process.exit(1);
  }
}
