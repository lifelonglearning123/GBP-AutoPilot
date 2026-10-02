import { location } from '@/lib/locations';
import { notFound } from 'next/navigation';
import { get, MIN_RESULTS } from '@/lib/benchmark';
import { locId } from '@/lib/ids';
import BenchmarkControls from '@/components/BenchmarkControls';
import { ord } from '@/lib/format';
import { keywords, latestRun, summaryOf, ranksFor, history, previousPositions } from '@/lib/keywords';
import KeywordReport from '@/components/KeywordReport';
import KeywordManager, { KeywordRunBar } from '@/components/KeywordManager';

export const dynamic = 'force-dynamic';


export default async function CompetitorsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = location(locId(id));
  if (!l) notFound();
  const b = get(l);
  const hasSerper = Boolean(process.env.SERPER_API_KEY);
  const kws = keywords(l.id);
  const last = latestRun(l.id);
  const summary = summaryOf(last);

  return (
    <div className="flex flex-col gap-5">
      <KeywordRunBar id={l.id} weekly={Boolean(l.keywords_weekly)} ranAt={last?.ran_at ?? null} nextAt={l.next_keywords_at} active={kws.filter(k => k.active).length} hasSerper={hasSerper} />
      {summary && last ? (
        <KeywordReport summary={summary} ranks={ranksFor(last.id)} prev={previousPositions(l.id, last.id)} runs={history(l.id)} ranAt={last.ran_at} />
      ) : (
        <div className="panel p-6 text-sm muted">
          One search hides most of the picture: a business can be first for one service and nowhere for another. Check the searches customers use to see
          this business’s share of local search, who leads across all of them, and why.
        </div>
      )}
      <KeywordManager id={l.id} keywords={kws} hasSerper={hasSerper} />

      <details open={!summary}>
        <summary className="cursor-pointer font-semibold text-sm panel px-4 py-3">Main search in detail{b ? `: "${b.query}"` : ''} <span className="muted font-normal">· all 20 businesses, reviews and rating</span></summary>
        <div className="flex flex-col gap-5 mt-4">
      <BenchmarkControls id={l.id} query={b?.query ?? l.benchmark_query ?? ''} ranAt={l.benchmark_at} hasSerper={hasSerper} />

      {!b ? (
        <div className="panel p-8 text-center muted text-sm">
          No comparison yet. Run it to see where this business sits among the businesses Google Maps shows for the same search, and how its reviews and rating compare.
        </div>
      ) : b.thin ? (
        <div className="panel p-5 text-sm" style={{ color: 'var(--warn)' }}>
          Only {b.total} business{b.total === 1 ? '' : 'es'} came back for "{b.query}", fewer than {MIN_RESULTS}, so there is nothing meaningful to compare against and it is left out of the score.
          Try the phrase a customer would actually type, such as the everyday name for the trade plus the town.
        </div>
      ) : (
        <>
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
            <div className="panel p-4">
              <div className="text-xs muted">Position on Google Maps</div>
              <div className="text-3xl font-semibold score mt-1">{b.position ? `#${b.position}` : '—'}</div>
              <div className="text-xs muted mt-1">{b.position ? `of the first ${b.total} for "${b.query}"` : `Not in the first ${b.total} for "${b.query}"`}</div>
            </div>
            <div className="panel p-4">
              <div className="text-xs muted">Reviews</div>
              <div className="text-3xl font-semibold score mt-1">{b.self.reviews}</div>
              <div className="text-xs muted mt-1">{ord(b.stats.reviewRank)} most of {b.stats.field}. The top three shown average {b.stats.packAvgReviews}; the median is {b.stats.medianReviews}.</div>
            </div>
            <div className="panel p-4">
              <div className="text-xs muted">Star rating</div>
              <div className="text-3xl font-semibold score mt-1">{b.self.rating ?? '—'}{b.self.rating != null && '★'}</div>
              <div className="text-xs muted mt-1">{b.stats.medianRating != null ? `Local median ${b.stats.medianRating}★; the top three shown average ${b.stats.packAvgRating}★.` : 'No ratings to compare.'}</div>
            </div>
          </div>

          <div className="panel overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-xs muted uppercase text-left">
                <tr><th className="px-4 py-2 w-12">#</th><th className="px-4 py-2">Business</th><th className="px-4 py-2">Category</th><th className="px-4 py-2 text-right">Rating</th><th className="px-4 py-2 text-right">Reviews</th></tr>
              </thead>
              <tbody>
                {b.competitors.map(c => (
                  <tr key={c.cid} className="border-t" style={{ borderColor: 'var(--line-soft)', background: c.isSelf ? 'var(--accent-soft)' : undefined }}>
                    <td className="px-4 py-2 muted score">{c.position}</td>
                    <td className="px-4 py-2">
                      <a href={`https://www.google.com/maps?cid=${c.cid}`} target="_blank" rel="noopener" className={c.isSelf ? 'font-semibold' : 'hover:underline'}>{c.title}</a>
                      {c.isSelf && <span className="pill info ml-2">this business</span>}
                      <div className="text-xs muted">{c.address}</div>
                    </td>
                    <td className="px-4 py-2 muted text-xs">{c.category}</td>
                    <td className="px-4 py-2 text-right score">{c.rating ?? '—'}</td>
                    <td className="px-4 py-2 text-right score" style={{ fontWeight: c.isSelf ? 600 : undefined }}>{c.ratingCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs muted">
            Positions come from a Google Maps search for "{b.query}" with no fixed searcher location. Real positions shift with where the customer is standing and what they type, so treat them as a guide.
            Review count in the score is judged against the first three businesses shown.
          </p>
        </>
      )}
        </div>
      </details>
    </div>
  );
}
