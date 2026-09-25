import { AsyncLocalStorage } from 'node:async_hooks';
import { all, one, run, getSetting, setSetting } from './db';

/**
 * What each client costs to run. Google's own API is free, so the only spend is Serper searches and
 * AI calls; both are written here as they happen, with the business they were for.
 *
 * Jobs started from the browser carry their business in an async context, so the two places that
 * actually spend (the Serper fetches and the LLM client) can record it without every caller passing
 * an id. Background work (a map grid, a prospect batch) passes the id in directly.
 */
export type Source = 'serper' | 'ai';

type Ctx = { locationId: string | null; job: string };
const store = new AsyncLocalStorage<Ctx>();

/** Run something with the business and job it belongs to, so spend inside it is recorded against them. */
export function withUsage<T>(locationId: string | null | undefined, job: string, fn: () => T): T {
  return store.run({ locationId: locationId ?? null, job }, fn);
}

/** Serper credits per call, by endpoint. Serper charges /maps and /places more than a plain search. */
export const CREDITS: Record<string, number> = { maps: 3, places: 2, search: 1, reviews: 1, autocomplete: 1 };

/** Action names as a person would say them, so the usage page reads like work rather than code. */
const PLAIN: Record<string, string> = {
  'citations.audit': 'listings audit', 'keywords.run': 'searches', 'keywords.suggest': 'search suggestions',
  'suggest.generate': 'AI wording', 'posts.generate': 'post writing', 'reviews.draft': 'review replies',
  'reviews.poll': 'review replies', 'reviews.post': 'review replies', 'report.build': 'client report',
  'site.generate': 'website pages', 'grid.start': 'map grid', 'benchmark.run': 'competitor check',
  'benchmark.propose': 'competitor check', 'public.lookup': 'public listing', 'public.link': 'public listing',
  'public.refresh': 'public listing', 'public.create': 'public listing', 'public.candidates': 'public listing',
  'prospects.search': 'prospecting', 'prospects.start': 'prospecting', 'location.resync': 'profile read',
  'sync': 'profile read', 'scheduler.tick': 'scheduled jobs', 'scheduler.auto': 'scheduled jobs',
};
export const plainKind = (k: string) => PLAIN[k] ?? k;

export function meter(source: Source, what: { kind?: string; locationId?: string | null; credits?: number; calls?: number; tokens?: number }) {
  const ctx = store.getStore();
  const locationId = what.locationId !== undefined ? what.locationId : ctx?.locationId ?? null;
  const kind = what.kind ?? plainKind(ctx?.job ?? 'other');
  try {
    run('INSERT INTO usage_log (location_id, source, kind, credits, calls, tokens) VALUES (?,?,?,?,?,?)',
      locationId, source, kind, what.credits ?? 0, what.calls ?? 1, what.tokens ?? 0);
  } catch { /* metering must never break the job it is measuring */ }
}

// ---------------------------------------------------------------- rates and money

/** Prices to turn usage into money. Both are what the supplier charges, in US dollars. */
export type Rates = { serperPer1k: number; aiPer1m: number };
const DEFAULTS: Rates = { serperPer1k: 1, aiPer1m: 2 };

export function rates(): Rates {
  const raw = getSetting('usage_rates');
  if (!raw) return DEFAULTS;
  try { const r = JSON.parse(raw); return { serperPer1k: Number(r.serperPer1k) || DEFAULTS.serperPer1k, aiPer1m: Number(r.aiPer1m) || DEFAULTS.aiPer1m }; }
  catch { return DEFAULTS; }
}
export function saveRates(r: Partial<Rates>) {
  const next = { ...rates(), ...r };
  setSetting('usage_rates', JSON.stringify(next));
  return next;
}
export const costOf = (u: { credits: number; tokens: number }, r = rates()) =>
  (u.credits / 1000) * r.serperPer1k + (u.tokens / 1_000_000) * r.aiPer1m;

// ---------------------------------------------------------------- reading it back

export type Row = { location_id: string | null; title: string | null; credits: number; searches: number; ai_calls: number; tokens: number };

/** Months that have any usage, newest first, as YYYY-MM. */
export function months(): string[] {
  return all<{ m: string }>(`SELECT DISTINCT substr(at, 1, 7) AS m FROM usage_log ORDER BY m DESC`).map(r => r.m);
}

/** Usage for one month (YYYY-MM), one row per business, busiest first. Agency-wide work has no business. */
export function byLocation(month: string): Row[] {
  return all<Row>(
    `SELECT u.location_id, l.title,
            COALESCE(SUM(u.credits), 0) AS credits,
            COALESCE(SUM(CASE WHEN u.source = 'serper' THEN u.calls ELSE 0 END), 0) AS searches,
            COALESCE(SUM(CASE WHEN u.source = 'ai' THEN u.calls ELSE 0 END), 0) AS ai_calls,
            COALESCE(SUM(u.tokens), 0) AS tokens
       FROM usage_log u LEFT JOIN locations l ON l.id = u.location_id
      WHERE substr(u.at, 1, 7) = ?
      GROUP BY u.location_id
      ORDER BY credits DESC, ai_calls DESC`, month);
}

/** What a single business used in a month, split by job, for the detail line under each row. */
export function byKind(month: string, locationId: string | null): { kind: string; credits: number; calls: number; tokens: number }[] {
  return all<{ kind: string; credits: number; calls: number; tokens: number }>(
    `SELECT kind, COALESCE(SUM(credits), 0) AS credits, COALESCE(SUM(calls), 0) AS calls, COALESCE(SUM(tokens), 0) AS tokens
       FROM usage_log WHERE substr(at, 1, 7) = ? AND location_id IS ${locationId === null ? 'NULL' : '?'}
      GROUP BY kind ORDER BY credits DESC, calls DESC`,
    ...(locationId === null ? [month] : [month, locationId]));
}

export function monthTotal(month: string): { credits: number; searches: number; ai_calls: number; tokens: number } {
  return one<{ credits: number; searches: number; ai_calls: number; tokens: number }>(
    `SELECT COALESCE(SUM(credits), 0) AS credits,
            COALESCE(SUM(CASE WHEN source = 'serper' THEN calls ELSE 0 END), 0) AS searches,
            COALESCE(SUM(CASE WHEN source = 'ai' THEN calls ELSE 0 END), 0) AS ai_calls,
            COALESCE(SUM(tokens), 0) AS tokens
       FROM usage_log WHERE substr(at, 1, 7) = ?`, month) ?? { credits: 0, searches: 0, ai_calls: 0, tokens: 0 };
}

export const thisMonth = () => new Date().toISOString().slice(0, 7);
export const monthLabel = (m: string) => new Date(`${m}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
