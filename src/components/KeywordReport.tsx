import type { RunSummary, RankRow, Hit, RunRow } from '@/lib/keywords';
import { visibilityPoints, likeForLike } from '@/lib/keywords';

type Rank = RankRow & { hits: Hit[] };

function Trend({ runs }: { runs: RunRow[] }) {
  const vals = runs.map(r => r.visibility ?? 0);
  if (vals.length < 2) return null;
  const w = 140, h = 34, max = Math.max(100, ...vals);
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - (v / max) * h}`).join(' ');
  return <svg width={w} height={h} className="opacity-80"><polyline fill="none" stroke="var(--info)" strokeWidth="2" points={pts} /></svg>;
}

const cell = (pos: number | null) => (pos ? `#${pos}` : '–');
const tone = (pos: number | null) => (!pos ? 'var(--muted)' : pos <= 3 ? 'var(--good)' : pos <= 10 ? 'var(--warn)' : 'var(--bad)');

/** Share of local search, who leads across all the searches, where this business sits in each, and why. */
export default function KeywordReport({ summary, ranks, prev, runs, ranAt }: {
  summary: RunSummary; ranks: Rank[]; prev: Map<string, number | null>; runs: RunRow[]; ranAt: string;
}) {
  const me = summary.leaderboard.find(b => b.isSelf);
  const rivals = summary.leaderboard.filter(b => !b.isSelf).slice(0, 4);
  const leader = summary.leaderboard.find(b => !b.isSelf);
  const change = likeForLike(ranks, prev);
  const scoredRanks = ranks.filter(r => r.intent === 'ok');
  const otherRanks = ranks.filter(r => r.intent !== 'ok');
  const maxShare = Math.max(1, ...summary.leaderboard.map(b => b.share));

  return (
    <div className="flex flex-col gap-5">
      {/* Headline */}
      <div className="panel p-5 flex items-center gap-8 flex-wrap">
        <div>
          <div className="text-xs muted">Share of local search</div>
          <div className="text-4xl font-semibold score mt-1">{summary.visibility}%</div>
          <div className="text-xs muted mt-1">across {summary.scored} search{summary.scored === 1 ? '' : 'es'} customers use{summary.total > summary.scored ? ` (${summary.total - summary.scored} left out)` : ''}</div>
        </div>
        <div className="text-sm flex-1 min-w-[240px]">
          {me && <div>{me.top3 ? <>In the top three for <strong>{me.top3}</strong> of {summary.scored}.</> : <>Not in the top three for any of them.</>} {ordinalLine(summary)}</div>}
          {leader && <div className="muted mt-1">{leader.title} leads with {leader.share}%, in the top three for {leader.top3} of {summary.scored}.</div>}
        </div>
        <div className="text-right">
          <Trend runs={runs} />
          <div className="text-xs muted mt-1">
            {!change ? `First check ${ranAt.slice(0, 10)}`
              : <><span style={{ color: change.delta > 0 ? 'var(--good)' : change.delta < 0 ? 'var(--bad)' : 'var(--muted)' }}>{change.delta > 0 ? '+' : ''}{change.delta} pts</span> since last check, on the {change.searches} searches checked both times</>}
          </div>
        </div>
      </div>

      {/* Leaderboard */}
      <div className="panel p-5">
        <h2 className="font-semibold mb-1">Who shows up most</h2>
        <p className="text-xs muted mb-3">Share of local search across the same searches. The first three positions carry most of the weight, because that is where most calls go.</p>
        <div className="flex flex-col gap-1.5">
          {summary.leaderboard.map((b, i) => (
            <div key={b.cid} className="grid items-center gap-3 text-sm" style={{ gridTemplateColumns: '28px minmax(0,1.6fr) minmax(0,2fr) 90px 80px' }}>
              <span className="muted score">{b.isSelf && summary.rank ? summary.rank : i + 1}</span>
              <a href={`https://www.google.com/maps?cid=${b.cid}`} target="_blank" rel="noopener" className={`truncate ${b.isSelf ? 'font-semibold' : 'hover:underline'}`}>{b.title}{b.isSelf && <span className="pill info ml-2">this business</span>}</a>
              <div className="h-2 rounded" style={{ background: 'var(--line)' }}>
                <div className="h-2 rounded" style={{ width: `${(b.share / maxShare) * 100}%`, background: b.isSelf ? 'var(--accent)' : 'var(--muted)' }} />
              </div>
              <span className="score text-right">{b.share}%</span>
              <span className="text-xs muted text-right">top 3 in {b.top3}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Search × competitor grid */}
      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs muted uppercase text-left">
            <tr>
              <th className="px-4 py-2">Search</th>
              <th className="px-3 py-2 text-center">You</th>
              <th className="px-3 py-2 text-center">Change</th>
              {rivals.map(r => <th key={r.cid} className="px-3 py-2 text-center normal-case font-medium" title={r.title}><span className="block max-w-[120px] truncate mx-auto">{r.title}</span></th>)}
            </tr>
          </thead>
          <tbody>
            {scoredRanks.map(r => {
              const was = prev.get(r.phrase.toLowerCase());
              const moved = was === undefined ? null : (was ?? 21) - (r.position ?? 21);
              return (
                <tr key={r.id} className="border-t" style={{ borderColor: 'var(--line-soft)' }}>
                  <td className="px-4 py-2">{r.phrase}<div className="text-xs muted">{visibilityPoints(r.position)} of 100 points</div></td>
                  <td className="px-3 py-2 text-center score font-semibold" style={{ color: tone(r.position) }}>{cell(r.position)}</td>
                  <td className="px-3 py-2 text-center text-xs score">
                    {moved == null ? <span className="muted">new</span> : moved === 0 ? <span className="muted">–</span>
                      : <span style={{ color: moved > 0 ? 'var(--good)' : 'var(--bad)' }}>{moved > 0 ? '▲' : '▼'} {Math.abs(moved)}</span>}
                  </td>
                  {rivals.map(c => {
                    const p = r.hits.find(h => h.cid === c.cid)?.position ?? null;
                    return <td key={c.cid} className="px-3 py-2 text-center score" style={{ color: tone(p) }}>{cell(p)}</td>;
                  })}
                </tr>
              );
            })}
            {otherRanks.map(r => (
              <tr key={r.id} className="border-t" style={{ borderColor: 'var(--line-soft)', opacity: 0.6 }}>
                <td className="px-4 py-2">{r.phrase}<div className="text-xs" style={{ color: 'var(--warn)' }}>
                  {r.intent === 'wrong' ? `Wrong kind of results: ${r.note || 'not businesses like this one'}` : r.intent === 'error' ? r.note : `Too few results (${r.note})`}. Not counted.
                </div></td>
                <td colSpan={2 + rivals.length} className="px-3 py-2 text-xs muted">left out of the share</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Gaps */}
      {summary.gaps.length > 0 && (
        <div className="panel p-5">
          <h2 className="font-semibold mb-1">Why the leaders are ahead</h2>
          <p className="text-xs muted mb-3">From the full Google profiles of the most visible competitors, compared with this one.</p>
          <ul className="flex flex-col gap-2 text-sm">
            {summary.gaps.map((g, i) => (
              <li key={i} className="panel-2 px-3 py-2 flex gap-3">
                <span className="pill shrink-0" style={{ alignSelf: 'flex-start' }}>{{ category: 'Category', weak: 'Not ranking', reviews: 'Reviews', intent: 'Search' }[g.type]}</span>
                <span>{g.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ordinalLine(s: RunSummary): string {
  const n = s.rank ?? s.leaderboard.findIndex(b => b.isSelf) + 1;
  if (n < 1) return '';
  const suf = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suf} most visible${s.field ? ` of the ${s.field} businesses that appear` : ' business'}.`;
}
