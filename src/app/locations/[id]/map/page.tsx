import Link from 'next/link';
import { location, view } from '@/lib/locations';
import { locId, locParam } from '@/lib/ids';
import { keywords as keywordList, latestRun as latestKeywordRun, ranksFor } from '@/lib/keywords';
import { latestGrid, latestDoneGrid, previousDoneGrid, gridSummary, gridPointsFor, centre, phoneQuery, isRunning, sidesLine } from '@/lib/grid';
import GridControls from '@/components/GridControls';
import GridMap from '@/components/GridMap';
import { ensureCentre, centreNote } from '@/lib/geo';

export const dynamic = 'force-dynamic';

export default async function MapPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ k?: string }> }) {
  const { id } = await params;
  const { k } = await searchParams;
  const l = location(locId(id))!;
  const v = view(l);
  // Google hands over a pin only when someone placed it by hand, so the position is worked out from
  // the address the first time this tab is opened, and kept.
  const c = await ensureCentre(l.id);
  const kws = keywordList(l.id).filter(x => x.active);
  // Positions from the Competitors tab, to explain a map that disagrees with them.
  const kr = latestKeywordRun(l.id);
  const tabPos = new Map((kr ? ranksFor(kr.id) : []).filter(r => r.intent === 'ok').map(r => [r.phrase.toLowerCase(), r.position]));
  const latest = latestGrid(l.id);
  const done = latestDoneGrid(l.id);
  const summary = gridSummary(done);
  const pts = done ? gridPointsFor(done.id) : [];
  const lastIds = [...new Set(pts.map(p => p.keyword_id).filter((x): x is number => x != null))];
  const running = Boolean(latest && latest.status === 'running' && isRunning(latest.id));
  const selected = summary?.keywords[Math.min(Number(k ?? 0) || 0, Math.max(0, (summary?.keywords.length ?? 1) - 1))];
  const selPts = selected ? pts.filter(p => p.phrase === selected.phrase) : [];
  const prev = done ? previousDoneGrid(l.id, done.id) : undefined;
  const prevK = prev && prev.size === done!.size && prev.radius_mi === done!.radius_mi && prev.zoom === done!.zoom ? gridSummary(prev)?.keywords.find(x => x.phrase === selected?.phrase && x.query === selected?.query) : undefined;
  const base = `/locations/${locParam(l.id)}/map`;
  const diff = (a: number, b: number | undefined, better: 'up' | 'down') => {
    if (b === undefined) return null;
    const d = Math.round((a - b) * 10) / 10;
    if (!d) return <span className="muted"> (no change)</span>;
    const good = better === 'up' ? d > 0 : d < 0;
    return <span style={{ color: good ? 'var(--good)' : 'var(--bad)' }}> ({d > 0 ? '+' : ''}{d})</span>;
  };

  return (
    <div className="flex flex-col gap-5">
      <GridControls
        id={l.id}
        keywords={kws.map(x => ({ id: x.id, phrase: x.phrase, query: phoneQuery(x.phrase, v.town), intent: x.intent, primary: x.source === 'primary', position: tabPos.get(x.phrase.toLowerCase()) ?? null }))}
        running={running}
        progress={running && latest ? { done: latest.done, total: latest.total } : null}
        monthly={Boolean(l.grid_monthly)}
        last={done ? { size: done.size, radius: done.radius_mi, keywordIds: lastIds, withTown: Boolean(pts[0] && pts[0].query === pts[0].phrase) } : null}
        hasSerper={Boolean(process.env.SERPER_API_KEY)}
        hasPin={Boolean(c)}
        centredOn={c ? centreNote(c) : null}
      />
      {latest?.status === 'error' && latest.id !== done?.id && <div className="panel p-3 text-sm" style={{ color: 'var(--bad)' }}>The last map did not finish: {latest.error}</div>}

      {!summary || !selected || !done ? (
        !running && <div className="panel p-8 text-center text-sm muted">No map yet. Choose a grid and the searches to map, then click Check the map.</div>
      ) : (
        <>
          {summary.keywords.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {summary.keywords.map((x, i) => (
                <Link key={x.phrase} href={`${base}?k=${i}`} className={`tab ${x.phrase === selected.phrase ? 'active' : ''}`}>{x.phrase} <span className="muted">· {x.top3}/{x.points} top 3</span></Link>
              ))}
            </div>
          )}

          <div className="grid gap-5" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(260px, 2fr)' }}>
            <div className="flex flex-col gap-2">
              <GridMap points={selPts} centre={{ lat: done.center_lat, lng: done.center_lng }} zoom={done.zoom} />
              <div className="flex flex-wrap gap-3 text-xs muted items-center">
                <span><span className="inline-block w-3 h-3 rounded-full align-middle mr-1" style={{ background: '#16a34a' }} />1st to 3rd</span>
                <span><span className="inline-block w-3 h-3 rounded-full align-middle mr-1" style={{ background: '#d97706' }} />4th to 10th</span>
                <span><span className="inline-block w-3 h-3 rounded-full align-middle mr-1" style={{ background: '#dc2626' }} />11th to 20th</span>
                <span><span className="inline-block w-3 h-3 rounded-full align-middle mr-1" style={{ background: '#6b7280' }} />not in the first 20</span>
                <span>· 📍 the business · click a circle to see that search on Google Maps</span>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="panel p-4">
                <div className="text-xs muted">"{selected.query}" searched from {selected.points} points up to {done.radius_mi} mile{done.radius_mi === 1 ? '' : 's'} away</div>
                <div className="grid grid-cols-3 gap-3 mt-3">
                  <div><div className="text-2xl font-semibold score">{selected.top3}<span className="text-sm muted">/{selected.points}</span></div><div className="text-xs muted">in the top three{diff(selected.top3, prevK?.top3, 'up')}</div></div>
                  <div><div className="text-2xl font-semibold score">{selected.found}<span className="text-sm muted">/{selected.points}</span></div><div className="text-xs muted">found at all{diff(selected.found, prevK?.found, 'up')}</div></div>
                  <div><div className="text-2xl font-semibold score">{selected.avgRank}</div><div className="text-xs muted">average position{diff(selected.avgRank, prevK?.avgRank, 'down')}</div></div>
                </div>
                <p className="text-sm mt-3">{sidesLine(selected, done.radius_mi)}</p>
                {(() => {
                  const tp = tabPos.get(selected.phrase.toLowerCase());
                  if (selected.found > selected.points / 3 || selected.query === selected.phrase || !tp) return null;
                  return (
                    <p className="text-sm mt-2" style={{ color: 'var(--warn)' }}>
                      Yet it is #{tp} for "{selected.phrase}" on the Competitors tab. Google links the business with that search but not with the plain word "{selected.query}"
                      typed by someone nearby. Reviews, a description and services that use the word "{selected.query}" help Google make the connection.
                      Tick "Keep the town in each search" to map it the Competitors-tab way.
                    </p>
                  );
                })()}
                {prevK && <p className="text-xs muted mt-2">Changes are against the previous map from {prev!.ran_at.slice(0, 10)}.</p>}
              </div>

              <div className="panel p-4">
                <div className="font-semibold text-sm mb-2">Who is first across the map</div>
                <ul className="flex flex-col gap-1.5 text-sm">
                  {selected.leaders.map(b => (
                    <li key={b.cid} className="flex justify-between gap-3">
                      <span className={`truncate ${b.isSelf ? 'font-semibold' : ''}`}>{b.title}{b.isSelf && <span className="pill info ml-2">this business</span>}</span>
                      <span className="muted whitespace-nowrap score">1st at {b.firsts} · top 3 at {b.top3}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="text-xs muted">
                Checked {done.ran_at.slice(0, 16)} · {done.size} × {done.size} grid · {done.credits} credits used{done.error ? ` · ${done.error}` : ''}.
                Each point is a Google Maps search for "{selected.query}" from that spot, at map zoom {done.zoom}.{' '}
                {done.zoom === 13 ? 'That is the close-range zoom, the same for every 0.5, 1 and 2 mile map, so a spot reads the same on any of them.'
                  : done.zoom === 11 ? 'That is the wider-area zoom, used for 3 and 5 mile maps; positions are not comparable with close-range maps.'
                  : 'This map was made before distances were grouped, with a zoom of its own, so it is only compared with maps made the same way.'}
                {' '}Positions also change with the exact spot and the wording, so maps are only compared with maps made with the same settings.
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
