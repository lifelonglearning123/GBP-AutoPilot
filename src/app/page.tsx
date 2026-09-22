import Link from 'next/link';
import Action from '@/components/Action';
import AddBusiness from '@/components/AddBusiness';
import { summary } from '@/lib/extras';
import { get as getBenchmark } from '@/lib/benchmark';
import { latestRun as latestKeywordRun, summaryOf } from '@/lib/keywords';
import { locations, view } from '@/lib/locations';
import { audit, LOW_COVERAGE } from '@/lib/audit';
import { one } from '@/lib/db';
import { isMock } from '@/lib/gbp';
import { getConnection, hasOAuthConfig, viaPipedream } from '@/lib/gauth';
import { hasLLM } from '@/lib/llm';
import { locParam } from '@/lib/ids';

export const dynamic = 'force-dynamic';

export default function Dashboard() {
  const locs = locations();
  const mock = isMock();
  const conn = getConnection();
  const pd = viaPipedream();
  const connected = Boolean(conn) || pd;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="muted text-sm mt-1">Every managed profile, scored against the local SEO checklist.</p>
        </div>
        <div className="flex gap-2">
          <AddBusiness />
          <Action action="scheduler.tick" busy="Running…">Run scheduler now</Action>
          <Action action="sync" className="btn primary" busy="Syncing…">Sync from Google</Action>
        </div>
      </div>

      {(!hasLLM() || (!connected && !mock) || (!hasOAuthConfig() && !mock && !pd)) && (
        <div className="panel p-4 text-sm flex flex-col gap-1">
          {!hasLLM() && <div>No LLM key. Add <code>OPENAI_API_KEY</code> to <code>.env.local</code> and restart.</div>}
          {!hasOAuthConfig() && !pd && <div>No Google OAuth client. Add <code>GOOGLE_CLIENT_ID</code> / <code>GOOGLE_CLIENT_SECRET</code>, or keep <code>GBP_MOCK=1</code> while waiting for API approval.</div>}
          {hasOAuthConfig() && !connected && <div>Google is not connected. <Link className="underline" href="/settings">Connect on Settings</Link>.</div>}
          {mock && <div className="muted">Mock mode: fixtures stand in for Google. Sync to load two sample locations.</div>}
        </div>
      )}

      {locs.length === 0 ? (
        <div className="panel p-8 text-center muted">
          No businesses yet. <strong className="text-[var(--text)]">Add a business by hand</strong> to audit any profile straight away,
          or <strong className="text-[var(--text)]">Sync from Google</strong> once the account is connected to pull every profile it manages.
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
          {locs.map(l => {
            const v = view(l);
            const { score, items, coverage } = audit(l);
            const partial = coverage < LOW_COVERAGE;
            const failing = items.filter(i => !i.ok && !i.unknown).sort((x, y) => y.weight * (1 - y.points) - x.weight * (1 - x.points));
            const unreplied = one<{ n: number }>(`SELECT COUNT(*) AS n FROM reviews WHERE location_id = ? AND (reply_comment IS NULL OR reply_comment = '') AND draft_status != 'skipped'`, l.id)?.n ?? 0;
            const drafts = one<{ n: number }>(`SELECT COUNT(*) AS n FROM posts WHERE location_id = ? AND status = 'draft'`, l.id)?.n ?? 0;
            const pending = one<{ n: number }>(`SELECT COUNT(*) AS n FROM suggestions WHERE location_id = ? AND status = 'pending'`, l.id)?.n ?? 0;
            const m = summary(l.id);
            const bm = getBenchmark(l);
            const ks = summaryOf(latestKeywordRun(l.id));
            const stat = (k: string) => m.find(x => x.key === k);
            return (
              <Link key={l.id} href={`/locations/${locParam(l.id)}`} className="panel p-5 flex flex-col gap-3 hover:border-[#303947]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold flex items-center gap-2">{l.title}{l.account === 'manual' && <span className="pill warn">manual</span>}</div>
                    <div className="text-xs muted">{v.primaryCategory?.displayName ?? 'No category'} · {v.town || 'No town'}</div>
                    {ks && ks.scored > 0 ? (
                      <div className="text-xs mt-1">
                        <span className="text-[var(--text)] font-semibold">{ks.visibility}%</span>
                        <span className="muted"> share of local search · {ks.rank ? (ks.field ? `${ks.rank} of ${ks.field}` : `#${ks.rank}`) : ks.rank === null ? 'not in the results' : '–'} · top 3 in {ks.leaderboard.find(b => b.isSelf)?.top3 ?? 0} of {ks.scored} searches</span>
                      </div>
                    ) : bm && !bm.thin && (
                      <div className="text-xs mt-1">
                        <span className="text-[var(--text)]">{bm.position ? `#${bm.position}` : 'Not in top ' + bm.total}</span>
                        <span className="muted"> for "{bm.query}" · {bm.self.reviews} reviews vs top three avg {bm.stats.packAvgReviews}</span>
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className={`score text-2xl font-semibold ${partial ? 'muted' : score >= 80 ? 'text-[var(--good)]' : score >= 50 ? 'text-[var(--warn)]' : 'text-[var(--bad)]'}`}>{score}</div>
                    {partial && <div className="text-xs muted">{coverage}% checked</div>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {unreplied > 0 && <span className="pill warn">{unreplied} unreplied review{unreplied > 1 ? 's' : ''}</span>}
                  {pending > 0 && <span className="pill info">{pending} suggestion{pending > 1 ? 's' : ''} to approve</span>}
                  {drafts > 0 && <span className="pill info">{drafts} post draft{drafts > 1 ? 's' : ''}</span>}
                  <span className={`pill ${l.auto_reply ? 'good' : ''}`}>Auto-reply {l.auto_reply ? 'on' : 'off'}</span>
                  <span className={`pill ${l.next_post_at ? 'good' : ''}`}>Weekly post {l.next_post_at ? 'scheduled' : 'off'}</span>
                </div>
                {m.length > 0 && (
                  <div className="flex gap-4 text-xs">
                    {['views', 'calls', 'website', 'directions'].map(k => { const s = stat(k); if (!s) return null; const d = s.prev28 ? Math.round(((s.last28 - s.prev28) / s.prev28) * 100) : 0;
                      return <div key={k}><div className="muted">{s.label}</div><div className="font-semibold">{s.last28} <span className={d >= 0 ? 'text-[var(--good)]' : 'text-[var(--bad)]'}>{d >= 0 ? '+' : ''}{d}%</span></div></div>; })}
                  </div>
                )}
                <ul className="text-xs muted flex flex-col gap-0.5">
                  {failing.slice(0, 4).map(i => (
                    <li key={i.key} className="flex justify-between gap-3">
                      <span><span style={{ color: i.grade === 'partial' ? 'var(--warn)' : 'var(--bad)' }}>{i.grade === 'partial' ? '◐' : '✗'}</span> {i.label}</span>
                      <span className="score">−{Math.round(i.weight * (1 - i.points))}</span>
                    </li>
                  ))}
                  {failing.length > 4 && <li>+{failing.length - 4} more</li>}
                  {failing.length === 0 && <li className="text-[var(--good)]">Everything on the checklist is in place.</li>}
                </ul>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
