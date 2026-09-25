import Link from 'next/link';
import Action from '@/components/Action';
import AddBusiness from '@/components/AddBusiness';
import AlertList from '@/components/AlertList';
import StatusIcon from '@/components/StatusIcon';
import { get as getBenchmark } from '@/lib/benchmark';
import { latestRun as latestKeywordRun, summaryOf } from '@/lib/keywords';
import { locations, view, type LocationRow } from '@/lib/locations';
import { audit, LOW_COVERAGE } from '@/lib/audit';
import { all } from '@/lib/db';
import { isMock } from '@/lib/gbp';
import { isConnected, hasOAuthConfig, viaPipedream } from '@/lib/gauth';
import { hasLLM } from '@/lib/llm';
import { locParam } from '@/lib/ids';
import { openAlerts, unseenCounts } from '@/lib/alerts';
import { weeklyChange } from '@/lib/history';
import { TODO, atStake, nextSteps, worth } from '@/lib/steps';
import { ord } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** A score at or above this is "in good shape"; the same line where scores turn green. */
const GOOD = 80;

const counts = (sql: string) => new Map(all<{ id: string; n: number }>(sql).map(r => [r.id, r.n]));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const scoreColour = (score: number, partial: boolean) =>
  partial ? 'var(--muted)' : score >= GOOD ? 'var(--good)' : score >= 50 ? 'var(--warn)' : 'var(--bad)';

type Order = 'low' | 'high' | 'name';
const ORDERS: { key: Order; label: string }[] = [
  { key: 'low', label: 'Lowest score first' },
  { key: 'high', label: 'Highest score first' },
  { key: 'name', label: 'A to Z' },
];

type Waiting = { href: string; text: string; tone?: 'bad' };

function row(l: LocationRow, waiting: { alerts: number; reviews: number; suggestions: number; drafts: number }) {
  const v = view(l);
  const { score, items, coverage } = audit(l);
  const base = `/locations/${locParam(l.id)}`;
  const todo: Waiting[] = [];
  if (waiting.alerts) todo.push({ href: `${base}/reviews`, text: plural(waiting.alerts, 'new bad review'), tone: 'bad' });
  if (waiting.reviews) todo.push({ href: `${base}/reviews`, text: `${plural(waiting.reviews, 'review')} to reply to` });
  if (waiting.suggestions) todo.push({ href: `${base}#ai`, text: `${plural(waiting.suggestions, 'suggestion')} to approve` });
  if (waiting.drafts) todo.push({ href: `${base}/posts`, text: `${plural(waiting.drafts, 'post draft')} to check` });
  return {
    l, base, score, coverage, partial: coverage < LOW_COVERAGE,
    category: v.primaryCategory?.displayName ?? null, town: v.town || null,
    place: `${l.title.trim().toLowerCase()}|${(v.address.postalCode ?? v.addressLine).replace(/\s+/g, '').toLowerCase()}`,
    next: nextSteps(items)[0] ?? null,
    week: weeklyChange(l.id),
    search: summaryOf(latestKeywordRun(l.id)),
    bench: getBenchmark(l),
    todo,
  };
}
type Row = ReturnType<typeof row>;

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  const { sort } = await searchParams;
  const order: Order = sort === 'name' || sort === 'high' ? sort : 'low';
  const byName = order === 'name';
  const mock = isMock();
  const pd = viaPipedream();
  const connected = isConnected() || pd;

  const alerts = unseenCounts();
  const reviews = counts(`SELECT location_id AS id, COUNT(*) AS n FROM reviews WHERE (reply_comment IS NULL OR reply_comment = '') AND draft_status != 'skipped' GROUP BY location_id`);
  const suggestions = counts(`SELECT location_id AS id, COUNT(*) AS n FROM suggestions WHERE status = 'pending' GROUP BY location_id`);
  const drafts = counts(`SELECT location_id AS id, COUNT(*) AS n FROM posts WHERE status = 'draft' GROUP BY location_id`);

  const rows = locations().map(l => row(l, {
    alerts: alerts.get(l.id) ?? 0, reviews: reviews.get(l.id) ?? 0,
    suggestions: suggestions.get(l.id) ?? 0, drafts: drafts.get(l.id) ?? 0,
  }));
  const byTitle = (a: Row, b: Row) => a.l.title.localeCompare(b.l.title);
  rows.sort(order === 'name' ? byTitle
    : order === 'high' ? (a, b) => b.score - a.score || byTitle(a, b)
    : (a, b) => a.score - b.score || byTitle(a, b));
  // Two profiles with the same name at the same postcode are almost always one shop listed twice.
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(r.place, (seen.get(r.place) ?? 0) + 1);
  const dupes = new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
  const needs = rows.filter(r => r.score < GOOD);
  const fine = rows.filter(r => r.score >= GOOD);
  const busy = rows.filter(r => r.todo.length).length;
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  const setup = [
    !hasLLM() && <>No AI key yet. Add <code>OPENAI_API_KEY</code> to <code>.env.local</code> and restart the app.</>,
    !hasOAuthConfig() && !pd && !mock && <>No Google sign-in set up. Add <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code>, or keep <code>GBP_MOCK=1</code> while waiting for API approval.</>,
    hasOAuthConfig() && !connected && <>Google is not connected. <Link className="underline" href="/settings">Connect it in Settings</Link>.</>,
    mock && <>Sample mode: made-up data stands in for Google. Sync to load two sample businesses.</>,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-end justify-between gap-x-6 gap-y-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold">Dashboard</h1>
          <p className="muted mt-1.5">
            {today}.{' '}
            {rows.length === 0 ? 'Add a business to get started.'
              : busy === 0 ? 'Nothing is waiting for you.'
              : `${busy === 1 ? 'One business has' : `${busy} of ${rows.length} businesses have`} something waiting for you.`}
          </p>
        </div>
        <div className="flex gap-2">
          <AddBusiness />
          <Action action="sync" className="btn primary" busy="Syncing…">Sync from Google</Action>
        </div>
      </header>

      {setup.length > 0 && (
        <div className="panel-2 px-4 py-3 text-sm flex flex-col gap-1">
          {setup.map((s, i) => <p key={i}>{s}</p>)}
        </div>
      )}

      <AlertList alerts={openAlerts()} />

      {rows.length === 0 ? (
        <div className="panel p-10 text-center flex flex-col items-center gap-2">
          <h2 className="text-lg font-semibold">No businesses yet</h2>
          <p className="muted max-w-prose">
            Add one by hand to audit any profile straight away, or sync from Google once the account is connected to bring in every profile it manages.
          </p>
        </div>
      ) : (
        <section aria-labelledby="biz-h" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h2 id="biz-h" className="text-lg font-semibold">Businesses <span className="muted font-normal score">{rows.length}</span></h2>
            <nav aria-label="Order" className="flex items-center gap-1 text-sm">
              <span className="muted mr-1">Order</span>
              {ORDERS.map(o => (
                <Link key={o.key} href={o.key === 'low' ? '/' : `/?sort=${o.key}`} className={`tab ${order === o.key ? 'active' : ''}`}
                  aria-current={order === o.key ? 'true' : undefined}>{o.label}</Link>
              ))}
            </nav>
          </div>

          <div className="panel overflow-hidden @container">
            <div className="biz-grid hidden @[56rem]:grid px-5 py-2.5 text-xs muted" style={{ background: 'var(--panel-2)' }} aria-hidden>
              <span>Business</span><span>Score</span><span>Local search</span><span>Waiting for you</span><span>Biggest next step</span>
            </div>
            {byName ? rows.map(r => <BizRow key={r.l.id} r={r} dupe={dupes.has(r.place)} />) : (
              <>
                {order === 'high' && fine.length > 0 && <Group label="In good shape" hint={`Score ${GOOD} or more`} rows={fine} dupes={dupes} />}
                {needs.length > 0 && <Group label="Needs attention" hint={`Score under ${GOOD}`} rows={needs} dupes={dupes} />}
                {order === 'low' && fine.length > 0 && <Group label="In good shape" hint={`Score ${GOOD} or more`} rows={fine} dupes={dupes} />}
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function Group({ label, hint, rows, dupes }: { label: string; hint: string; rows: Row[]; dupes: Set<string> }) {
  return (
    <section aria-label={label}>
      <div className="px-5 pt-5 pb-1 flex items-baseline gap-2">
        <h3 className="text-sm font-semibold">{label}</h3>
        <span className="text-xs muted">{hint}, {plural(rows.length, 'business', 'businesses')}</span>
      </div>
      {rows.map(r => <BizRow key={r.l.id} r={r} dupe={dupes.has(r.place)} />)}
    </section>
  );
}

/** One business as one row. The name is the link; the row stretches it so the whole row opens the business. */
function BizRow({ r, dupe }: { r: Row; dupe: boolean }) {
  const colour = scoreColour(r.score, r.partial);
  const where = [r.category, r.town].filter(Boolean).join(', ');
  return (
    <div className="biz-row biz-grid relative px-5 py-4 border-t flex flex-col gap-2 @[56rem]:gap-0">
      <div className="min-w-0 flex items-start justify-between gap-4 @[56rem]:block">
        <div className="min-w-0">
          <Link href={r.base} className="row-link font-semibold leading-snug">{r.l.title}</Link>
          <div className="text-sm muted mt-0.5 flex items-center gap-2 flex-wrap">
            <span>{where || 'No category or town yet'}</span>
            {r.l.account === 'manual' && (
              <span className="text-xs rounded-md px-1.5 py-px border" style={{ borderColor: 'var(--line-strong)' }}
                title="Added by hand: read from the public listing, not managed through Google">By hand</span>
            )}
            {dupe && (
              <span className="text-xs rounded-md px-1.5 py-px border" style={{ color: 'var(--warn)', borderColor: 'var(--warn-line)', background: 'var(--warn-bg)' }}
                title="Another profile has the same name and postcode. Duplicate listings split reviews and break Google's rules: keep one and ask Google to remove the other.">Possible duplicate</span>
            )}
          </div>
        </div>
        <div className="@[56rem]:hidden"><Score r={r} colour={colour} /></div>
      </div>

      <div className="hidden @[56rem]:block"><Score r={r} colour={colour} /></div>

      <div className={`text-sm ${r.search?.scored || (r.bench && !r.bench.thin) ? '' : 'hidden @[56rem]:block'}`}>
        <span className="@[56rem]:hidden muted">Local search: </span>
        {r.search && r.search.scored > 0 ? (
          <>
            <span className="font-semibold score">{Math.round(r.search.visibility)}%</span>
            <span className="muted"> of searches</span>
            <div className="muted text-xs mt-0.5 hidden @[56rem]:block">
              {r.search.rank ? `${ord(r.search.rank)}${r.search.field ? ` of ${r.search.field} businesses` : ''}` : 'Not in the results'}
            </div>
          </>
        ) : r.bench && !r.bench.thin ? (
          <>
            <span className="font-semibold">{r.bench.position ? ord(r.bench.position) : `Not in the top ${r.bench.total}`}</span>
            <div className="muted text-xs mt-0.5 hidden @[56rem]:block truncate" title={r.bench.query}>for “{r.bench.query}”</div>
          </>
        ) : <span className="muted">Not checked yet</span>}
      </div>

      <div className="text-sm">
        {r.todo.length === 0 ? <span className="muted hidden @[56rem]:inline">Nothing</span> : (
          <ul className="flex flex-col gap-0.5">
            {r.todo.map(t => (
              <li key={t.text}>
                <Link href={t.href} className="relative z-[1] underline decoration-[var(--line-strong)] underline-offset-4 hover:decoration-current"
                  style={{ color: t.tone === 'bad' ? 'var(--bad)' : 'var(--accent-text)' }}>{t.text}</Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="text-sm min-w-0">
        {r.next ? (
          <div className="flex items-start gap-2">
            <span className="mt-0.5"><StatusIcon grade={r.next.grade} size={15} /></span>
            <span>
              <span className="@[56rem]:hidden muted">Next: </span>{TODO[r.next.key] ?? r.next.label}
              <span className="block text-xs muted score mt-0.5">Worth up to {worth(atStake(r.next))}</span>
            </span>
          </div>
        ) : (
          <div className="flex items-start gap-2">
            <span className="mt-0.5"><StatusIcon grade="good" size={15} /></span>
            <span className="muted">{r.partial ? 'Nothing found so far' : 'Nothing to fix'}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Score({ r, colour }: { r: Row; colour: string }) {
  const change = r.week && !r.partial ? r.week.delta : null;
  return (
    <div className="flex flex-col items-end @[56rem]:items-start">
      <div className="flex items-center gap-2.5">
        <span className="score display text-xl font-semibold leading-none" style={{ color: colour }}>{r.score}</span>
        <span className="hidden @[56rem]:block h-1.5 w-12 rounded-full overflow-hidden" style={{ background: 'var(--line-soft)' }} aria-hidden>
          <span className="block h-full rounded-full" style={{ width: `${r.score}%`, background: colour }} />
        </span>
      </div>
      <div className="text-xs mt-1 score">
        {r.partial ? <span className="muted">{r.coverage}% checked</span>
          : change === null ? null
          : change === 0 ? <span className="muted">Same as last week</span>
          : <span style={{ color: change > 0 ? 'var(--good)' : 'var(--bad)' }}>{change > 0 ? `Up ${change}` : `Down ${-change}`} this week</span>}
      </div>
    </div>
  );
}
