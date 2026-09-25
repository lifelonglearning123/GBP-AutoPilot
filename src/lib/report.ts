import fs from 'node:fs';
import path from 'node:path';
import { all, parse, log } from './db';
import { json as llmJson } from './llm';
import { location, view, updateConfig, isLinked, slugify } from './locations';
import { audit, groupTotals, type AuditItem, type AuditGroup } from './audit';
import { ensureBenchmark, get as getBenchmark, type Benchmark, type Competitor } from './benchmark';
import { ord, pts } from './format';
import { ensureKeywordRun, latestRun as latestKeywordRun, summaryOf, ranksFor, type Gap as KeywordGap, type Leader } from './keywords';
import { latestDoneGrid, gridSummary, gridPointsFor, mapLayout, rankColour, sidesLine, type KeywordGrid } from './grid';
import { latestRun, citations, missingDirectories, DIRECTORIES, type CitationRow } from './citations';
import { pages, matrix } from './site';
import { agency } from './agency';
import { ensureFresh, snapshot } from './public';
import { hostOf } from './nap';
import { scoreHistory, trendSvg, weekLabel, type WeekScore } from './history';

/**
 * The prospect report: one self-contained HTML page a business owner can read on a phone.
 * Score, the checklist in plain words, what the web says about their name/address/phone, the
 * pages they are missing, and three things to do first. Print to PDF from the browser.
 */
export type ReportData = {
  generatedAt: string;
  business: { title: string; category: string; addressLine: string; phone: string; website: string; town: string; linked: boolean };
  score: number;
  /** Weekly scores, oldest first (up to 12 weeks). */
  history: WeekScore[];
  /** Share of the checklist weight the app could actually see; the rest is "not checked". */
  coverage: number;
  /** Where the Google-side facts came from, stated on the report so nobody reads guesses as findings. */
  source: { kind: 'api' | 'public' | 'none'; rating: number | null; ratingCount: number | null; readAt: string | null; mapsUrl: string | null };
  checklist: Pick<AuditItem, 'label' | 'group' | 'weight' | 'points' | 'unknown' | 'ok' | 'grade' | 'note'>[];
  groups: { group: AuditGroup; weight: number; knownWeight: number; earned: number }[];
  /** Where the business sits among what Google Maps shows for a customer's search; null if not run or too thin. */
  market: (Pick<Benchmark, 'query' | 'position' | 'total' | 'self' | 'stats'> & { table: Competitor[] }) | null;
  /** Across every tracked customer search: share of local search, positions, who leads, and why. */
  keywords: {
    visibility: number; scored: number; rank: number; field: number | null;
    leaderboard: Leader[];
    rows: { phrase: string; position: number | null; leader: string | null; leaderReviews: number | null }[];
    left: { phrase: string; why: string }[];
    gaps: KeywordGap[];
  } | null;
  /** The latest map grid, if one has been run (it is never run automatically for a report: it costs credits). */
  map: {
    main: KeywordGrid; sides: string; size: number; radius: number; zoom: number; checked: string;
    centre: { lat: number; lng: number };
    points: { lat: number; lng: number; position: number | null; error: string | null }[];
    others: KeywordGrid[];
  } | null;
  citations: { run: ReturnType<typeof latestRun>; rows: CitationRow[]; missing: typeof DIRECTORIES };
  site: { built: number; planned: number; services: string[]; areas: string[] };
  summary: { headline: string; findings: string[]; actions: string[] };
  agency: ReturnType<typeof agency>;
};

async function summarise(d: Omit<ReportData, 'summary' | 'agency'>): Promise<ReportData['summary']> {
  const line = (c: ReportData['checklist'][number]) => `${c.label} (${pts(c.points * c.weight)} of ${pts(c.weight)} points): ${c.note}`;
  const failing = d.checklist.filter(c => !c.ok && !c.unknown).sort((a, b) => b.weight * (1 - b.points) - a.weight * (1 - a.points)).map(line);
  const passing = d.checklist.filter(c => c.ok).map(line);
  const m = d.market;
  const unknown = d.checklist.filter(c => c.unknown).map(c => c.label);
  const own = hostOf(d.business.website);
  const mism = d.citations.rows.filter(r => r.status === 'mismatch').map(r =>
    `${own && r.domain.replace(/^www\./, '') === own ? `the business's own website (${r.domain})` : r.directory ?? r.domain}: ${parse<string[]>(r.issues, []).filter(x => !/snippet/.test(x)).join(', ')}`);
  const system = `You write the summary page of a local SEO audit for a small business owner who is not technical. British English, plain, specific, no jargon, no hype, no emojis. Never invent facts; use only the findings given.
When a local comparison is given, lead the headline with where the business stands against its competitors, because that is what decides who gets the call. If a share of local search across several searches is given, lead with that rather than any single search, and name the searches where it is strongest and weakest. Compare with the individual businesses listed, not only the average: never say it has fewer reviews than each of them if any has fewer. When a business ranks above this one with fewer reviews, reviews are not the only thing holding this one back, so say so rather than blaming review count alone. Items that lose the most points matter most; weigh findings by points lost, not by count.
Items listed as NOT CHECKED were not visible to the audit. Never describe them as missing, empty or failing, and never recommend fixing them; at most say they were not checked. Acknowledge genuine strengths (for example a strong rating) rather than implying the profile is weak when it is not.
Return JSON: { "headline": one sentence on where they stand (max 25 words), "findings": 3 to 5 short bullets on what is holding the profile back, most damaging first, "actions": exactly 3 bullets, each one concrete thing to do first, in order }`;
  const user = [
    `Business: ${d.business.title}, ${d.business.category || 'local business'} in ${d.business.town}`,
    `Score: ${d.score}/100, based on ${d.coverage}% of the checklist that could be seen`,
    `Data source: ${d.source.kind === 'api' ? 'the Business Profile API' : d.source.kind === 'public' ? `the public Google listing (${d.source.rating ?? '-'} stars from ${d.source.ratingCount ?? 0} reviews)` : 'details typed in by hand only; no Google listing linked'}`,
    m ? `Local comparison, Google Maps search "${m.query}": ${m.position ? `appears #${m.position} of the first ${m.total}` : `not among the first ${m.total}`}. Reviews ${m.self.reviews}, ${ord(m.stats.reviewRank)} most of ${m.stats.field}; the three businesses shown first average ${m.stats.packAvgReviews} reviews and ${m.stats.packAvgRating ?? '-'} stars (individually: ${m.table.filter(c => !c.isSelf).slice(0, 3).map(c => `#${c.position} ${c.title}, ${c.ratingCount} reviews, ${c.rating ?? '-'} stars`).join('; ')}); local median ${m.stats.medianReviews} reviews and ${m.stats.medianRating ?? '-'} stars. This business: ${m.self.rating ?? '-'} stars.`
      : 'Local comparison: not available.',
    d.map ? `Map grid for "${d.map.main.query}", searched on Google Maps from ${d.map.main.points} points up to ${d.map.radius} miles around the business: in the top three at ${d.map.main.top3}, found at ${d.map.main.found}, average position ${d.map.main.avgRank}. ${d.map.sides} First most often across the map: ${d.map.main.leaders.slice(0, 2).map(b => `${b.title} (1st at ${b.firsts})`).join(', ')}.`
      : 'Map grid: not run.',
    d.keywords ? `Share of local search across ${d.keywords.scored} searches customers use: ${d.keywords.visibility}%, ${ord(d.keywords.rank)}${d.keywords.field ? ` of ${d.keywords.field} businesses that appear` : ' most visible'}. Leaders: ${d.keywords.leaderboard.filter(b => !b.isSelf).slice(0, 3).map(b => `${b.title} ${b.share}% (top three in ${b.top3})`).join('; ')}.
Position per search: ${d.keywords.rows.map(r => `"${r.phrase}" ${r.position ? `#${r.position}` : 'not in top 20'}${r.leader ? ` (led by ${r.leader}, ${r.leaderReviews} reviews)` : ''}`).join('; ')}.
Why the leaders are ahead:\n${d.keywords.gaps.map(g => `- ${g.text}`).join('\n') || '- nothing specific'}` : 'Multi-search comparison: not available.',
    `Checklist items passing:\n${passing.map(x => `- ${x}`).join('\n') || '- none'}`,
    `Checklist items losing points, most points lost first:\n${failing.map(x => `- ${x}`).join('\n') || '- none'}`,
    `NOT CHECKED (do not comment on these as problems): ${unknown.join(', ') || 'none'}`,
    `Phone on the Google profile: ${d.business.phone || 'none'}`,
    `Citation audit: ${d.citations.run ? `${d.citations.run.found} listings found, ${d.citations.run.matches} consistent, ${d.citations.run.mismatches} with wrong details` : 'not run'}`,
    `Wrong details found:\n${mism.map(x => `- ${x}`).join('\n') || '- none'}`,
    `Key directories with no listing: ${d.citations.missing.map(m => m.label).join(', ') || 'none'}`,
    // The page count is our own proposal from the site generator, not a check of the business's website.
    `Our recommendation (NOT a finding about their current website, which was not checked; do not describe pages as missing): ${d.site.planned} service and area pages covering ${d.site.services.join(', ') || 'their services'} in ${d.site.areas.join(', ') || 'their area'}.`,
  ].join('\n\n');
  try {
    const out = await llmJson<ReportData['summary']>(system, user);
    return { headline: String(out.headline ?? ''), findings: (out.findings ?? []).map(String).slice(0, 5), actions: (out.actions ?? []).map(String).slice(0, 3) };
  } catch (e: any) {
    return { headline: `Profile scores ${d.score} out of 100.`, findings: failing.slice(0, 5), actions: failing.slice(0, 3) };
  }
}

export async function build(locationId: string): Promise<{ data: ReportData; html: string; file: string }> {
  // Hand-added business: refresh the public Google listing before scoring anything.
  await ensureFresh(locationId);
  // Local competitors: one cached Maps search, shared by every business in the same market.
  await ensureBenchmark(locationId);
  // Every tracked customer search (suggested on first use), re-checked if more than a week old.
  await ensureKeywordRun(locationId);
  const l = location(locationId);
  if (!l) throw new Error('Unknown location');
  const v = view(l);
  const { score, items, source, coverage } = audit(l);
  const pub = snapshot(l);
  const bm = getBenchmark(l);
  // The first five shown, plus this business if it is further down or missing, so the table always includes it.
  const table = bm && !bm.thin ? [...bm.competitors.slice(0, 5), ...bm.competitors.slice(5).filter(c => c.isSelf)] : [];
  const gr = latestDoneGrid(l.id);
  const gs = gridSummary(gr);
  const kr = latestKeywordRun(l.id);
  const ks = summaryOf(kr);
  const kranks = kr ? ranksFor(kr.id) : [];
  const run = latestRun(l.id);
  // Directories often serve one listing at several URLs; show each distinct listing once.
  const seen = new Set<string>();
  const rows = (run ? citations(run.id).filter(r => r.status !== 'not_listed' && r.status !== 'error') : []).filter(r => {
    const k = [r.domain.replace(/^[a-z]+\.(?=[a-z-]+\.[a-z.]+$)/, ''), r.status, (r.name_found ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''), (r.phone_found ?? '').replace(/\D/g, ''), (r.address_found ?? '').toLowerCase().replace(/\W/g, '')].join('|');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const missing = run ? missingDirectories(run.id) : DIRECTORIES;
  const built = pages(l.id);
  const planned = matrix(v);
  const partial: Omit<ReportData, 'summary' | 'agency'> = {
    generatedAt: new Date().toISOString(),
    business: { title: v.title, category: v.primaryCategory?.displayName ?? '', addressLine: v.addressLine, phone: v.phone ?? '', website: v.website ?? '', town: v.town, linked: isLinked(l) },
    score,
    history: scoreHistory(l.id, 12),
    coverage,
    source: {
      kind: source,
      rating: pub?.listing.rating ?? null,
      ratingCount: pub?.listing.ratingCount ?? null,
      readAt: source === 'public' ? (l.public_synced_at ?? null) : source === 'api' ? (l.synced_at ?? null) : null,
      mapsUrl: v.maps_uri ?? null,
    },
    checklist: items.map(i => ({ label: i.label, group: i.group, weight: i.weight, points: i.points, unknown: i.unknown, ok: i.ok, grade: i.grade, note: i.note })),
    groups: groupTotals(items).map(({ items: _, ...g }) => g),
    market: bm && !bm.thin ? { query: bm.query, position: bm.position, total: bm.total, self: bm.self, stats: bm.stats, table } : null,
    keywords: ks && ks.scored ? {
      visibility: ks.visibility,
      scored: ks.scored,
      rank: ks.rank ?? Math.max(1, ks.leaderboard.findIndex(b => b.isSelf) + 1),
      field: ks.field ?? null,
      leaderboard: [...ks.leaderboard.slice(0, 5), ...ks.leaderboard.slice(5).filter(b => b.isSelf)],
      rows: kranks.filter(r => r.intent === 'ok').map(r => {
        const lead = r.hits.find(h => !h.isSelf && h.position === 1) ?? r.hits.find(h => !h.isSelf);
        return { phrase: r.phrase, position: r.position, leader: r.position === 1 ? null : lead?.title ?? null, leaderReviews: r.position === 1 ? null : lead?.ratingCount ?? null };
      }),
      left: kranks.filter(r => r.intent !== 'ok').map(r => ({ phrase: r.phrase, why: r.intent === 'wrong' ? `returns ${r.note || 'a different kind of business'}` : r.intent === 'error' ? 'could not be read this time' : 'too few results' })),
      gaps: ks.gaps.filter(g => g.type !== 'intent').slice(0, 6),
    } : null,
    map: gr && gs && gs.keywords.length ? {
      main: gs.keywords[0],
      sides: sidesLine(gs.keywords[0], gr.radius_mi),
      size: gr.size, radius: gr.radius_mi, zoom: gr.zoom, checked: gr.ran_at,
      centre: { lat: gr.center_lat, lng: gr.center_lng },
      points: gridPointsFor(gr.id).filter(p => p.phrase === gs.keywords[0].phrase).map(p => ({ lat: p.lat, lng: p.lng, position: p.position, error: p.error })),
      others: gs.keywords.slice(1),
    } : null,
    citations: { run, rows, missing },
    site: { built: built.length, planned: planned.length, services: v.offeredServices.length ? v.offeredServices : v.serviceNames, areas: v.serviceAreas.length ? v.serviceAreas : [v.town].filter(Boolean) },
  };
  const data: ReportData = { ...partial, summary: await summarise(partial), agency: agency() };
  const html = render(data);
  const dir = path.join(process.cwd(), 'output', 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slugify(v.title)}-${data.generatedAt.slice(0, 10)}.html`);
  fs.writeFileSync(file, html, 'utf8');
  updateConfig(l.id, { report_url: file });
  log('report', 'ok', file, l.id);
  return { data, html, file };
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function render(d: ReportData): string {
  const a = d.agency;
  const colour = a.colour || '#1f5f8b';
  const tone = d.coverage < 50 ? '#9ca3af' : d.score >= 80 ? '#1f9d55' : d.score >= 50 ? '#d98a00' : '#d64545';
  const date = new Date(d.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const STATUS: Record<string, [string, string]> = { match: ['Consistent', '#1f9d55'], mismatch: ['Wrong details', '#d64545'], partial: ['Incomplete', '#d98a00'], other: ['Different business', '#6b7280'] };
  const cit = d.citations.rows.filter(r => r.status !== 'other');
  const own = hostOf(d.business.website);
  const site = (r: CitationRow) => own && r.domain.replace(/^www\./, '') === own ? `Your own website<br><span class="muted">${esc(r.domain)}</span>` : esc(r.directory ?? r.domain);
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Local SEO audit: ${esc(d.business.title)}</title>
<style>
:root{--c:${colour}}*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1c2430;line-height:1.5;background:#f6f7f9}
.page{max-width:820px;margin:0 auto;background:#fff;padding:40px 44px}@media print{body{background:#fff}.page{padding:0}.nobreak{break-inside:avoid}}
header{display:flex;justify-content:space-between;align-items:center;gap:16px;border-bottom:3px solid var(--c);padding-bottom:16px;margin-bottom:28px}
header img{max-height:44px}header .ag{font-weight:700;color:var(--c);font-size:1.1rem}header .meta{font-size:.85rem;color:#6b7280;text-align:right}
h1{font-size:1.7rem;margin:0 0 4px}h2{font-size:1.15rem;margin:32px 0 10px;color:var(--c)}.sub{color:#6b7280;margin:0 0 20px}
.score{display:flex;gap:24px;align-items:center;background:#f6f7f9;border-radius:14px;padding:20px 24px}.score .n{font-size:3.2rem;font-weight:800;color:${tone};line-height:1}.score .n small{font-size:1rem;color:#6b7280;font-weight:500}
ul{padding-left:20px}li{margin:4px 0}.check{list-style:none;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:6px 18px}.check li{display:flex;gap:8px;font-size:.92rem}.check .ok{color:#1f9d55}.check .no{color:#d64545}.check .un{color:#9ca3af}.check li.unk{color:#6b7280}.check small{display:block;color:#6b7280;font-size:.8rem}
.src{font-size:.82rem;color:#6b7280;margin-top:10px}
.mkt{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:6px 0 14px}.mkt div{background:#f6f7f9;border-radius:12px;padding:12px 14px}.mkt b{display:block;font-size:1.6rem;line-height:1.1}.mkt span{font-size:.8rem;color:#6b7280}
tr.me td{background:#eef4ff;font-weight:600}
.gmap{position:relative;width:100%;overflow:hidden;border-radius:12px;border:1px solid #e5e7eb;background:#eef0f3}.gmap img{position:absolute;display:block}
.gpin{position:absolute;transform:translate(-50%,-50%);width:26px;height:26px;border-radius:50%;border:2px solid #fff;color:#fff;font:600 11px/22px system-ui,sans-serif;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.35)}
.gkey{display:flex;flex-wrap:wrap;gap:12px;font-size:.78rem;color:#6b7280;margin:8px 0}.gkey i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px;vertical-align:middle}td.r{text-align:right;font-variant-numeric:tabular-nums}
.grp{display:flex;justify-content:space-between;align-items:baseline;margin:18px 0 6px;font-size:.78rem;text-transform:uppercase;letter-spacing:.04em;color:#6b7280}.grp b{color:#1c2430;font-size:.85rem;letter-spacing:0}
.check .pt{margin-left:auto;padding-left:10px;font-size:.8rem;color:#6b7280;white-space:nowrap;font-variant-numeric:tabular-nums}.check .part{color:#d98a00}
@media(max-width:620px){.mkt{grid-template-columns:1fr}.check{grid-template-columns:1fr}.page{padding:24px 18px}}.diff{background:#fff7e6;border:1px solid #f3d38a;border-radius:12px;padding:14px 18px;margin-top:18px}.diff h3{margin:0 0 6px;font-size:1rem;color:#8a5a00}
table{width:100%;border-collapse:collapse;font-size:.88rem}th{text-align:left;color:#6b7280;font-weight:600;font-size:.75rem;text-transform:uppercase;padding:6px 8px;border-bottom:1px solid #e5e7eb}td{padding:8px;border-bottom:1px solid #f0f1f3;vertical-align:top}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:.75rem;font-weight:600;color:#fff}.muted{color:#6b7280}
.actions{background:var(--c);color:#fff;border-radius:14px;padding:20px 24px}.actions h2{color:#fff;margin-top:0}.actions ol{margin:0;padding-left:20px}.actions li{margin:6px 0}
.chips span{display:inline-block;background:#f0f1f3;border-radius:8px;padding:3px 9px;margin:2px 4px 2px 0;font-size:.85rem}
footer{margin-top:36px;padding-top:14px;border-top:1px solid #e5e7eb;font-size:.85rem;color:#6b7280;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}
</style></head><body><div class="page">
<header>
  <div>${a.logo_url ? `<img src="${esc(a.logo_url)}" alt="${esc(a.name)}">` : `<div class="ag">${esc(a.name || 'Local SEO audit')}</div>`}</div>
  <div class="meta">Local SEO audit<br>${esc(date)}</div>
</header>
<h1>${esc(d.business.title)}</h1>
<p class="sub">${esc([d.business.category, d.business.addressLine, d.business.phone].filter(Boolean).join(' · '))}</p>

<div class="score nobreak"><div class="n">${d.score}<small>/100</small></div><div><strong>${esc(d.summary.headline)}</strong><div class="muted" style="margin-top:6px">Out of 100: reviews 40, consistency across the web 15, profile 20, categories 12, activity 5, basics 8. Each check earns part of its points, so a strong profile and a middling one score differently.</div></div></div>
${d.history.length >= 2 ? `<div class="nobreak" style="margin:10px 0 4px"><div class="muted" style="font-size:.85rem">Score by week, from the week of ${esc(weekLabel(d.history[0].week))}: ${d.history.map(h => h.score).join(', ')}</div>${trendSvg(d.history)}</div>` : ''}
<p class="src">${d.source.kind === 'api'
  ? 'Read directly from the Google Business Profile.'
  : d.source.kind === 'public'
    ? `Based on the public Google listing${d.source.rating ? ` (${d.source.rating}★ from ${d.source.ratingCount} reviews)` : ''}${d.source.readAt ? `, read ${esc(new Date(d.source.readAt + 'Z').toLocaleDateString('en-GB'))}` : ''}. The score covers the ${d.coverage}% of checks visible publicly; description, services, posts and photos need owner access and are listed as not checked rather than counted against the business.`
    : `No Google listing was linked, so only the ${d.coverage}% of checks that do not need one are scored. Everything else is listed as not checked.`}</p>
${d.keywords ? `<h2>How you compare locally</h2>
<p>Across <strong>${d.keywords.scored} searches</strong> customers use to find this kind of business, ${esc(d.business.title)} has <strong>${d.keywords.visibility}%</strong> of the local search visibility, the <strong>${ord(d.keywords.rank)}</strong> most visible${d.keywords.field ? ` of the ${d.keywords.field} businesses that appear` : ' business'}.${(() => { const lead = d.keywords!.leaderboard.find(b => !b.isSelf); return lead ? ` ${esc(lead.title)} leads with ${lead.share}%.` : ''; })()} The first three positions carry most of the weight, because that is where most customers call.</p>
<div class="mkt nobreak">
  <div><b>${d.keywords.visibility}%</b><span>your share of local search</span></div>
  <div><b>${d.keywords.rows.filter(r => r.position && r.position <= 3).length} of ${d.keywords.scored}</b><span>searches where you are in the top three</span></div>
  <div><b>${d.keywords.rows.filter(r => !r.position || r.position > 10).length}</b><span>searches where you are outside the top ten</span></div>
</div>
<table class="nobreak"><thead><tr><th>Search</th><th style="text-align:right">You</th><th>Who leads</th></tr></thead><tbody>
${d.keywords.rows.map(r => `<tr${r.position === 1 ? ' class="me"' : ''}><td>${esc(r.phrase)}</td><td class="r">${r.position ? `#${r.position}` : 'not in top 20'}</td><td>${r.position === 1 ? 'You' : r.leader ? `${esc(r.leader)} <span class="muted">(${r.leaderReviews} reviews)</span>` : '–'}</td></tr>`).join('')}
</tbody></table>
${d.keywords.left.length ? `<p class="src">Left out of the share: ${d.keywords.left.map(x => `"${esc(x.phrase)}" (${esc(x.why)})`).join('; ')}.</p>` : ''}
<h3 style="margin:22px 0 8px;font-size:1rem">Who shows up most</h3>
<table class="nobreak"><thead><tr><th>#</th><th>Business</th><th style="text-align:right">Share</th><th style="text-align:right">Top three in</th></tr></thead><tbody>
${d.keywords.leaderboard.map((b, i) => `<tr${b.isSelf ? ' class="me"' : ''}><td>${b.isSelf ? d.keywords!.rank : i + 1}</td><td>${esc(b.title)}${b.isSelf ? ' (you)' : ''}</td><td class="r">${b.share}%</td><td class="r">${b.top3} of ${d.keywords!.scored}</td></tr>`).join('')}
</tbody></table>
${d.keywords.gaps.length ? `<h3 style="margin:22px 0 8px;font-size:1rem">Why the leaders are ahead</h3><ul>${d.keywords.gaps.map(g => `<li>${esc(g.text)}</li>`).join('')}</ul>` : ''}
<p class="src">Positions come from Google Maps searches with no fixed searcher location; they shift with where the customer is and exactly what they type.</p>` : d.market ? `<h2>How you compare locally</h2>
<p>${d.market.position
    ? `When a customer searches Google Maps for <strong>"${esc(d.market.query)}"</strong>, ${esc(d.business.title)} appears <strong>#${d.market.position}</strong> of the first ${d.market.total}.`
    : `When a customer searches Google Maps for <strong>"${esc(d.market.query)}"</strong>, ${esc(d.business.title)} is <strong>not among the first ${d.market.total}</strong> businesses shown.`}
 The first three shown are the ones most customers call.</p>
<div class="mkt nobreak">
  <div><b>${d.market.self.reviews}</b><span>your reviews, ${ord(d.market.stats.reviewRank)} most of ${d.market.stats.field}</span></div>
  <div><b>${d.market.stats.packAvgReviews}</b><span>average reviews of the first three shown</span></div>
  <div><b>${d.market.self.rating ?? '–'}${d.market.self.rating != null ? '★' : ''}</b><span>your rating; local median ${d.market.stats.medianRating ?? '–'}★</span></div>
</div>
<table class="nobreak"><thead><tr><th>#</th><th>Business</th><th style="text-align:right">Rating</th><th style="text-align:right">Reviews</th></tr></thead><tbody>
${d.market.table.map(c => `<tr${c.isSelf ? ' class="me"' : ''}><td>${c.position}</td><td>${esc(c.title)}${c.isSelf ? ' (you)' : ''}</td><td class="r">${c.rating ?? '–'}</td><td class="r">${c.ratingCount}</td></tr>`).join('')}
</tbody></table>
<p class="src">Positions come from a Google Maps search with no fixed searcher location; they shift with where the customer is and exactly what they type.</p>` : ''}

${d.map ? (() => {
  const m = d.map!;
  const L = mapLayout(m.points, m.centre);
  const leader = m.main.leaders[0];
  return `<h2>Where customers can find you</h2>
<p>We searched Google Maps for <strong>"${esc(m.main.query)}"</strong> from ${m.main.points} points up to ${m.radius} mile${m.radius === 1 ? '' : 's'} around ${esc(d.business.title)}. It is in the top three at <strong>${m.main.top3} of ${m.main.points}</strong> points and found at ${m.main.found}. ${esc(m.sides)}${leader && !leader.isSelf ? ` ${esc(leader.title)} is first at ${leader.firsts} of the ${m.main.points} points.` : leader?.isSelf ? ` It is first at ${leader.firsts} of the ${m.main.points} points, more than anyone else.` : ''}</p>
<div class="gmap nobreak" style="aspect-ratio:${L.ratio.toFixed(4)}">
${L.tiles.map(t => `<img src="${t.url}" alt="" style="left:${t.left.toFixed(3)}%;top:${t.top.toFixed(3)}%;width:${t.w.toFixed(3)}%;height:${t.h.toFixed(3)}%">`).join('')}
<div style="position:absolute;left:${L.centre.left.toFixed(3)}%;top:${L.centre.top.toFixed(3)}%;transform:translate(-50%,-115%);font-size:20px">📍</div>
${m.points.map((p, i) => `<div class="gpin" style="left:${L.pins[i].left.toFixed(3)}%;top:${L.pins[i].top.toFixed(3)}%;background:${p.error ? '#374151' : rankColour(p.position)}">${p.error ? '!' : p.position ?? '20+'}</div>`).join('')}
<div style="position:absolute;right:6px;bottom:3px;font-size:10px;color:#374151;background:rgba(255,255,255,.7);padding:0 4px;border-radius:3px">© OpenStreetMap contributors</div>
</div>
<div class="gkey"><span><i style="background:#16a34a"></i>1st to 3rd</span><span><i style="background:#d97706"></i>4th to 10th</span><span><i style="background:#dc2626"></i>11th to 20th</span><span><i style="background:#6b7280"></i>not in the first 20</span><span>📍 ${esc(d.business.title)}</span></div>
${m.others.length ? `<table class="nobreak"><thead><tr><th>Other searches mapped</th><th style="text-align:right">Top three at</th><th style="text-align:right">Found at</th><th style="text-align:right">Average position</th></tr></thead><tbody>
${m.others.map(o => `<tr><td>${esc(o.query)}</td><td class="r">${o.top3} of ${o.points}</td><td class="r">${o.found} of ${o.points}</td><td class="r">${o.avgRank}</td></tr>`).join('')}
</tbody></table>` : ''}
<p class="src">Each point is a Google Maps search from that spot, made ${esc(new Date(m.checked + 'Z').toLocaleDateString('en-GB'))}. Google weighs distance heavily, so where a customer is standing changes who they see first.</p>`;
})() : ''}

<h2>What is holding the profile back</h2>
<ul>${d.summary.findings.map(f => `<li>${esc(f)}</li>`).join('')}</ul>

<div class="actions nobreak"><h2>Do these three things first</h2><ol>${d.summary.actions.map(x => `<li>${esc(x)}</li>`).join('')}</ol></div>

<h2>Profile checklist</h2>
${d.groups.map(g => `<div class="grp nobreak"><span>${esc(g.group)}</span><b>${g.knownWeight ? `${pts(g.earned)} / ${pts(g.knownWeight)} points` : 'not checked'}</b></div>
<ul class="check">${d.checklist.filter(c => c.group === g.group).map(c => c.unknown
  ? `<li class="unk"><span class="un">?</span><span>${esc(c.label)} <em>(not checked)</em><small>${esc(c.note)}</small></span></li>`
  : `<li><span class="${c.grade === 'good' ? 'ok' : c.grade === 'partial' ? 'part' : 'no'}">${c.grade === 'good' ? '✓' : c.grade === 'partial' ? '◐' : '✗'}</span><span>${esc(c.label)}<small>${esc(c.note)}</small></span><span class="pt">${pts(c.points * c.weight)}/${pts(c.weight)}</span></li>`).join('')}</ul>`).join('')}

<h2>How the business appears across the web</h2>
${d.citations.run ? `<p class="muted">${d.citations.run.searched} web pages checked on ${esc(new Date(d.citations.run.ran_at + 'Z').toLocaleDateString('en-GB'))}. Google cross-checks the name, address and phone it finds elsewhere against the profile; every mismatch weakens trust.</p>
<table><thead><tr><th>Site</th><th>Status</th><th>Listed as</th><th>Problem</th></tr></thead><tbody>
${cit.map(r => `<tr><td>${site(r)}</td><td><span class="pill" style="background:${STATUS[r.status]?.[1] ?? '#6b7280'}">${STATUS[r.status]?.[0] ?? r.status}</span></td><td>${esc(r.name_found ?? '')}${r.address_found ? `<br><span class="muted">${esc(r.address_found)}</span>` : ''}${r.phone_found ? `<br><span class="muted">${esc(r.phone_found)}</span>` : ''}</td><td class="muted">${esc(parse<string[]>(r.issues, []).filter(x => !/snippet/.test(x)).join(' · '))}</td></tr>`).join('')}
</tbody></table>` : '<p class="muted">Citation audit not run.</p>'}
${d.citations.missing.length ? `<p style="margin-top:14px"><strong>Not listed on:</strong></p><p class="chips">${d.citations.missing.map(m => `<span>${esc(m.label)}</span>`).join('')}</p>` : ''}

<h2>Website pages we recommend</h2>
<p class="muted">Google matches local searches to pages about a specific service in a specific place. We recommend ${d.site.planned} page${d.site.planned === 1 ? '' : 's'}: one per service, one per area served, and one per service in each area, each with structured data and a directions link.${d.site.built ? ` ${d.site.built} ${d.site.built === 1 ? 'is' : 'are'} already drafted.` : ''}</p>
<p><strong>Services:</strong> <span class="chips">${d.site.services.map(s => `<span>${esc(s)}</span>`).join('') || '<span>not specified</span>'}</span></p>
<p><strong>Areas:</strong> <span class="chips">${d.site.areas.map(s => `<span>${esc(s)}</span>`).join('') || '<span>not specified</span>'}</span></p>

<footer>
  <div><strong>${esc(a.name || '')}</strong>${a.website ? ` · ${esc(a.website)}` : ''}${a.email ? ` · ${esc(a.email)}` : ''}${a.phone ? ` · ${esc(a.phone)}` : ''}</div>
  <div>Prepared ${esc(date)}</div>
</footer>
</div></body></html>`;
}
