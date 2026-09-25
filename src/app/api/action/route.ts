import { NextResponse } from 'next/server';
import { setSetting } from '@/lib/db';
import * as locations from '@/lib/locations';
import * as suggest from '@/lib/suggest';
import * as reviews from '@/lib/reviews';
import * as posts from '@/lib/posts';
import * as site from '@/lib/site';
import * as citations from '@/lib/citations';
import * as report from '@/lib/report';
import * as ghl from '@/lib/ghl';
import * as prospects from '@/lib/prospects';
import * as extras from '@/lib/extras';
import { saveAgency } from '@/lib/agency';
import * as pub from '@/lib/public';
import * as bench from '@/lib/benchmark';
import * as kw from '@/lib/keywords';
import * as grid from '@/lib/grid';
import { ensureCentre } from '@/lib/geo';
import { withUsage, saveRates } from '@/lib/usage';
import { tick } from '@/lib/scheduler';
import * as alerts from '@/lib/alerts';
import * as history from '@/lib/history';
import { createPhoto, testAccess } from '@/lib/gbp';

export const runtime = 'nodejs';
export const maxDuration = 600;

/**
 * Every mutation goes through here as { action, ...params }. One route instead of thirty keeps the
 * client trivial (see components/Action.tsx) and sidesteps server-action transport quirks on
 * localhost (oversized cookie headers from other local apps break the RSC reply).
 */
const handlers: Record<string, (p: any) => Promise<unknown> | unknown> = {
  'sync': () => locations.syncAll(),
  'google.test': async () => { const r = await testAccess(); if (!r.ok) throw new Error(r.detail); return r; },
  // Re-reading a profile also reads its photos, so the photo check is current.
  'location.resync': async p => { const r = await locations.resync(p.id); await extras.syncPhotos(p.id).catch(() => null); return r; },
  'photos.check': p => extras.syncPhotos(p.id),
  'reviews.postAll': p => reviews.postAll(p.id),
  'alerts.seen': p => alerts.markSeen(Number(p.id)),
  'alerts.seenAll': p => alerts.markAllSeen(p.locationId ? String(p.locationId) : undefined),
  'history.record': () => history.recordWeeklyScores(),
  'location.manual.save': p => locations.saveManual(p.input, p.id),
  'location.delete': p => locations.deleteLocation(p.id),

  // Public Google listing (Serper) for hand-added businesses.
  'public.lookup': p => pub.lookup(p.url),
  'public.create': async p => {
    const listing = await pub.fetchListing({ cid: p.cid });
    const a = pub.parseAddress(listing.address);
    const l = locations.saveManual({
      title: listing.title, street: a.street, town: a.town, postcode: a.postcode, phone: listing.phone ?? '', website: listing.website ?? '',
      category: listing.categories[0] ?? '',
    });
    await pub.enrich(l.id, { cid: listing.cid, matchedBy: 'link', captureEntered: false });
    return { id: l.id };
  },
  'public.candidates': p => pub.candidatesFor(p.id),
  'public.link': p => pub.link(p.id, { url: p.url, cid: p.cid }),
  'public.refresh': p => { const l = locations.location(p.id)!; if (!l.public_cid) throw new Error('Not linked to a Google listing yet'); return pub.enrich(p.id, { cid: l.public_cid, matchedBy: pub.snapshot(l)?.matchedBy ?? 'search' }); },
  'public.unlink': p => pub.unlink(p.id),

  // Competitor benchmark: where the business sits among what Google Maps shows for a customer search.
  'benchmark.run': p => bench.runBenchmark(p.id, p.query),
  'benchmark.propose': p => bench.proposeQuery(locations.location(p.id)!),

  // Multi-keyword visibility.
  'keywords.suggest': p => kw.suggestKeywords(p.id),
  'keywords.add': p => kw.addKeyword(p.id, String(p.phrase ?? '')),
  'keywords.toggle': p => kw.setActive(Number(p.kid), Boolean(p.active)),
  'keywords.remove': p => kw.removeKeyword(Number(p.kid)),
  'keywords.useSuggestion': p => kw.useSuggestion(Number(p.kid)),
  'keywords.run': p => kw.runKeywords(p.id),
  'keywords.weekly': p => locations.updateConfig(p.id, { keywords_weekly: p.on ? 1 : 0 }),

  // Map grid: runs in the background; the page polls the run's progress.
  'grid.start': async p => { await ensureCentre(p.id); return grid.startGrid(p.id, { size: Number(p.size), radiusMi: Number(p.radius), keywordIds: (p.keywordIds ?? []).map(Number), withTown: Boolean(p.withTown) }); },
  'grid.monthly': p => locations.updateConfig(p.id, { grid_monthly: p.on ? 1 : 0 }),
  'location.config': p => locations.updateConfig(p.id, p.config),
  'location.basics': p => locations.saveBasics(p.id, p.basics ?? {}),
  'categories.search': p => locations.findCategories(p.id, String(p.term ?? '')),
  'categories.resolve': p => locations.resolveCategory(p.id, String(p.name ?? '')),
  'location.schedule': p => {
    const l = locations.location(p.id)!;
    locations.updateConfig(p.id, { next_post_at: p.enabled ? posts.nextPostAt(l) : null });
  },

  'suggest.generate': p => suggest.generate(p.id),
  'suggest.apply': p => suggest.apply(Number(p.id)),
  'suggest.reject': p => suggest.rejectSuggestion(Number(p.id)),
  'suggest.edit': p => suggest.editSuggestion(Number(p.id), p.proposal),

  'reviews.poll': p => reviews.poll(p.id),
  'reviews.draft': p => reviews.draft(p.id),
  'reviews.post': p => reviews.post(p.id),
  'reviews.skip': p => reviews.skip(p.id),
  'reviews.edit': p => reviews.setDraft(p.id, p.reply),

  'posts.generate': p => posts.generate(p.id, p.angle),
  'posts.publish': p => posts.publish(Number(p.id)),
  'posts.reject': p => posts.reject(Number(p.id)),
  'posts.edit': p => posts.edit(Number(p.id), p.patch),
  'photo.upload': p => { const l = locations.location(p.id)!; return createPhoto(l.account, l.id, p.url, p.category, p.description); },

  'site.generate': p => site.generate(p.id, p.only),
  'site.build': p => site.build(p.id, p.baseUrl),

  'citations.audit': p => citations.audit(p.id),

  'report.build': p => report.build(p.id).then(r => ({ file: r.file })),
  'ghl.push': p => ghl.push(p.id, { pipelineId: p.pipelineId, stageId: p.stageId }),
  'ghl.pipelines': () => ghl.pipelines(),

  'prospects.importCsv': p => prospects.importCsv(p.name, p.csv, Number(p.budget) || 10),
  'prospects.search': p => prospects.searchPlaces(p.name, p.query, Number(p.budget) || 10),
  'prospects.start': p => prospects.start(Number(p.id)),
  'prospects.budget': p => prospects.setBudget(Number(p.id), Number(p.budget)),
  'prospects.skip': p => prospects.skip(Number(p.id)),
  'prospects.unskip': p => prospects.unskip(Number(p.id)),
  'prospects.delete': p => prospects.deleteBatch(Number(p.id)),
  'prospects.retry': p => prospects.retryErrors(Number(p.id)),

  'photos.enqueue': p => extras.enqueuePhotos(p.id, p.lines, p.category),
  'photos.remove': p => extras.removePhoto(Number(p.id)),
  'photos.post': p => extras.postPhoto(Number(p.id)),
  'metrics.sync': p => extras.syncMetrics(p.id),

  'agency.save': p => saveAgency(p.patch),
  'settings.set': p => setSetting(p.key, p.value),
  'usage.rates': p => saveRates({ serperPer1k: Number(p.serperPer1k), aiPer1m: Number(p.aiPer1m) }),
  'scheduler.tick': () => tick({ manual: true }),
  // Called by the scheduler's own timer (see start() in scheduler.ts). Answers at once and lets the
  // tick run on, because a tick can take minutes and the timer only needs to know it started.
  'scheduler.auto': () => { void tick().catch(() => {}); return 'started'; },
};

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }); }
  const h = handlers[body?.action];
  if (!h) return NextResponse.json({ error: `Unknown action ${body?.action}` }, { status: 400 });
  try {
    // The id in the request is the business this job is for, so usage.ts can bill it to them.
    const who = typeof body.id === 'string' && body.id.includes('/') ? body.id : typeof body.locationId === 'string' ? body.locationId : null;
    const result = await withUsage(who, String(body.action), () => h(body));
    return NextResponse.json({ ok: true, result: result ?? null });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
