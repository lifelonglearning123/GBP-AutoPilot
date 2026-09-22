import { getConnection, hasOAuthConfig, redirectUri, viaPipedream, pipedreamHalfSet, borrowedToken, pipedreamBudget, pipedreamWindows } from '@/lib/gauth';
import { isMock } from '@/lib/gbp';
import { llmInfo } from '@/lib/llm';
import { all, getSetting, parse } from '@/lib/db';
import Action from '@/components/Action';
import AgencyForm from '@/components/AgencyForm';
import { agencyPublic } from '@/lib/agency';

export const dynamic = 'force-dynamic';

const hm = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export default function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  return <Inner sp={searchParams} />;
}

async function Inner({ sp }: { sp: Promise<{ error?: string; connected?: string }> }) {
  const { error, connected } = await sp;
  const conn = getConnection();
  const pd = viaPipedream();
  const bt = borrowedToken();
  const budget = pipedreamBudget();
  const test = parse<{ ok: boolean; detail: string; at: string } | null>(getSetting('google_test'), null);
  const llm = llmInfo();
  const recent = all<{ job: string; status: string; detail: string; ran_at: string }>('SELECT job, status, detail, ran_at FROM job_log ORDER BY id DESC LIMIT 5');

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="panel p-5 flex flex-col gap-3">
        <h2 className="font-semibold">Google Business Profile</h2>
        {error && <div className="text-sm" style={{ color: 'var(--bad)' }}>{error}</div>}
        {connected && <div className="text-sm" style={{ color: 'var(--good)' }}>Connected.</div>}
        {pd ? (
          <div className="panel-2 p-4 flex flex-col gap-2 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="pill good">Through Pipedream</span>{' '}
                Google calls use the Google account connected in your Pipedream workflow, while Google reviews this project’s own API access.
              </div>
              <Action action="google.test" busy="Testing…">Test Google access</Action>
            </div>
            <div className="text-xs muted">
              {bt ? `Tokens fetched at ${hm(bt.fetchedAt)}, valid until ${hm(bt.expiresAt)}, for ${bt.logins.length} Google login${bt.logins.length === 1 ? '' : 's'}: ${bt.logins.map(l => l.name ?? l.email ?? l.login).join(', ')}.` : 'No token fetched yet. The first Google call, or the test, fetches one.'}
              {' '}To go back to your own connection, remove <code>PIPEDREAM_TOKEN_URL</code> from <code>.env.local</code>.
            </div>
            <div className="text-xs muted">
              Tokens used today: <strong>{budget.used} of {budget.limit}</strong>, resetting at {budget.resetsAt}. Each costs a Pipedream credit and lasts about an hour.
              {' '}To add another Google login, connect it in Pipedream (Accounts, Connect an app, Google Business Profile) and run <code>node --use-system-ca pipedream/deploy.mjs</code>. All logins share one token fetch, so this costs no extra credits.
              {' '}Reviews, posts and photos run in the windows at {pipedreamWindows().map(h => `${h}:00`).join(' and ')}. The last token of the day is kept for things you do yourself.
            </div>
          </div>
        ) : pipedreamHalfSet() ? (
          <div className="text-sm" style={{ color: 'var(--warn)' }}>
            Pipedream is half set up: <code>PIPEDREAM_TOKEN_SECRET</code> is set but <code>PIPEDREAM_TOKEN_URL</code> is not.
            Paste the workflow’s URL into <code>.env.local</code>, as in <code>pipedream/SETUP.md</code>.
          </div>
        ) : null}
        {test && (
          <div className="text-xs" style={{ color: test.ok ? 'var(--good)' : 'var(--bad)' }}>
            Last test, {new Date(test.at).toLocaleString('en-GB')}: {test.detail}
          </div>
        )}
        {conn ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <div>{pd ? 'Your own connection, unused while Pipedream is on: ' : 'Connected as '}<strong>{conn.email ?? 'unknown'}</strong> since {conn.connected_at.slice(0, 16)}</div>
            <div className="flex gap-2">
              {!pd && <Action action="google.test" busy="Testing…">Test Google access</Action>}
              <a className="btn danger" href="/api/auth/google/disconnect">Disconnect</a>
            </div>
          </div>
        ) : hasOAuthConfig() ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <div>Sign in with the Workspace account that every client has added as a Manager on their profile.</div>
            <a className="btn primary" href="/api/auth/google/start">Connect Google</a>
          </div>
        ) : (
          <div className="text-sm muted">Set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> in <code>.env.local</code>. Redirect URI to register: <code>{redirectUri()}</code></div>
        )}
        <div className="text-xs muted">
          Mode: <span className={`pill ${isMock() ? 'warn' : 'good'}`}>{isMock() ? 'Mock (fixtures)' : 'Live'}</span>
          {' '}Mock is on only while <code>GBP_MOCK=1</code>; it serves two sample businesses instead of Google.
        </div>
        <details className="text-xs muted">
          <summary className="cursor-pointer">Google Cloud setup checklist</summary>
          <ol className="list-decimal pl-5 mt-2 flex flex-col gap-1">
            <li>Create a Cloud project. Submit the Business Profile API access request form from an account that manages a verified profile.</li>
            <li>Once approved, enable all seven "My Business" APIs (Business Information, Account Management, Google My Business API, Q&A, Notifications, Verifications, Lodging).</li>
            <li>Google Auth Platform &gt; Audience: <strong>Internal</strong> if you have Workspace. Otherwise <strong>External</strong>, and then press <strong>Publish app</strong> so the status reads "In production" — External left in Testing expires the refresh token every 7 days. Scope <code>business.manage</code>.</li>
            <li>Credentials → OAuth client → Web application → redirect URI <code>{redirectUri()}</code>.</li>
            <li>Make sure <code>GBP_MOCK</code> is not set, then Connect Google and Sync.</li>
          </ol>
        </details>
      </section>

      <AgencyForm a={agencyPublic()} />

      <section className="panel p-5 flex flex-col gap-2">
        <h2 className="font-semibold">LLM</h2>
        <div className="text-sm">{llm.provider ? <>Using <strong>{llm.provider}</strong> · model <code>{llm.model}</code></> : <span style={{ color: 'var(--warn)' }}>No key set. Add OPENAI_API_KEY to .env.local.</span>}</div>
      </section>

      <section className="panel p-5 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Scheduler</h2>
          <Action action="scheduler.tick" busy="Running…">Run a tick now</Action>
        </div>
        <div className="text-xs muted">Ticks every 5 minutes while the app runs: reviews polled hourly per location, weekly posts when due.</div>
        <ul className="text-xs flex flex-col gap-0.5 mt-1">
          {recent.map((r, i) => <li key={i} className="flex gap-2"><span className="muted">{r.ran_at}</span><span className={r.status === 'error' ? 'text-[var(--bad)]' : ''}>{r.job}</span><span className="muted truncate">{r.detail}</span></li>)}
        </ul>
      </section>
    </div>
  );
}
