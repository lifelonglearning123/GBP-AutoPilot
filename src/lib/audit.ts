import { one } from './db';
import { view, isLinked, type LocationRow } from './locations';
import { snapshot } from './public';
import { get as getBenchmark } from './benchmark';

export type AuditGroup = 'Reviews' | 'Categories' | 'Consistency' | 'Profile' | 'Activity' | 'Basics';

export type AuditItem = {
  key: string;
  label: string;
  group: AuditGroup;
  /** Points available, out of 100 across the whole checklist. */
  weight: number;
  /** Share of the weight earned, 0 to 1. Graded, not pass/fail, so 13 reviews a quarter beats 3. */
  points: number;
  /**
   * The app cannot see this, so it is neither passed nor failed and is left out of the score.
   * Treating "unknown" as "failed" is what made a 115-review profile read as "0 reviews".
   */
  unknown: boolean;
  /** Kept for callers that list what needs attention: earned at least 80% of the weight. */
  ok: boolean;
  grade: 'good' | 'partial' | 'poor' | 'unknown';
  note: string;
  /** llm: the app can propose a fix. api: fixable by editing here. manual: only in the GBP dashboard. */
  fix: 'llm' | 'api' | 'manual' | 'none';
};

export type AuditSource = 'api' | 'public' | 'none';

/** Below this share of the checklist, the score says more about what we could not see than about the business. */
export const LOW_COVERAGE = 50;

/** Out of 100. Reviews and categories carry the most because they move local rankings the most. */
export const WEIGHTS = {
  // Basics, 8: every business Google Maps shows already has most of these, so they are a floor, not a differentiator.
  title: 1, phone: 1.5, website: 1.5, address: 1, latlng: 1, primary_category: 1, place_id: 1,
  // Reviews, 40
  review_count: 12, rating: 10, review_velocity: 10, reviews_replied: 8,
  // Categories, 12
  additional_categories: 12,
  // Profile, 20
  hours: 4, description: 6, services: 6, photos: 4,
  // Activity, 5
  post_weekly: 5,
  // Consistency, 15
  nap: 15,
} as const;

const clamp = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
/** Diminishing returns: the first 20 reviews matter far more than the 200th. */
const logScale = (n: number, target: number) => clamp(Math.log(n + 1) / Math.log(Math.max(target, 1) + 1));
/** Star rating pulled towards 4.3 when there are few reviews, so 4.8 from 8 reviews is not treated like 4.8 from 800. */
const bayes = (rating: number, n: number) => (rating * n + 4.3 * 10) / (n + 10);
/** 3.5 stars or below earns nothing; 4.8 and above earns everything. */
const ratingPoints = (r: number) => clamp((r - 3.5) / 1.3);

/**
 * The local SEO checklist, graded. What the app can see depends on the source:
 *  - api:    connected through the Business Profile API. Everything except photos.
 *  - public: hand-added and matched to its public Google listing. Not description, services or posts.
 *  - none:   hand-added with no listing matched. Only what was typed, plus the citation audit.
 *
 * When a competitor benchmark exists, review count is judged against the three businesses Google
 * shows first for the same search, because "enough reviews" depends entirely on the local market.
 */
export function audit(l: LocationRow): { score: number; items: AuditItem[]; source: AuditSource; coverage: number } {
  const v = view(l);
  const pub = isLinked(l) ? null : snapshot(l);
  const bench = getBenchmark(l);
  const market = bench && !bench.thin && bench.stats.packAvgReviews != null ? bench : null;
  const source: AuditSource = isLinked(l) ? 'api' : pub ? 'public' : 'none';
  const seesProfile = source !== 'none';
  const seesPrivate = source === 'api';

  const items: AuditItem[] = [];
  const add = (key: keyof typeof WEIGHTS, label: string, group: AuditGroup, points: number, note: string, fix: AuditItem['fix'], known = true) => {
    const p = known ? clamp(points) : 0;
    items.push({
      key, label, group, weight: WEIGHTS[key], points: p, unknown: !known, ok: known && p >= 0.8,
      grade: !known ? 'unknown' : p >= 0.8 ? 'good' : p >= 0.3 ? 'partial' : 'poor', note, fix,
    });
  };
  const NOT_PUBLIC = 'Not visible on the public listing; needs owner access to the profile to check.';
  const NO_LISTING = 'No Google listing matched yet. Link the business to its Google profile to check this.';
  const hiddenPrivate = source === 'public' ? NOT_PUBLIC : NO_LISTING;

  // ---------------- Basics ----------------
  add('title', 'Business name', 'Basics', v.title ? 1 : 0, 'Exactly as it appears on signage. No keyword stuffing; Google suspends for it.', 'manual');
  add('phone', 'Phone number', 'Basics', v.phone ? 1 : 0, 'Must match the number on the website and every directory.', 'manual');
  add('website', 'Website', 'Basics', v.website ? 1 : 0, v.website ? 'Linked from the profile.' : 'No website on the profile, so Google has less to confirm the business against.', 'manual');
  add('address', 'Address or service area', 'Basics', v.address.postalCode || (l.service_area_json && l.service_area_json !== 'null') ? 1 : 0,
    'Storefront address, or a service area for businesses that travel to customers.', 'manual');
  // Google only reports a pin that someone placed by hand on the Google Business Profile website
  // (the field "can only be updated by approved clients" and is dropped when the address geocodes).
  // A business on Google's own automatic pin is not doing anything wrong, so the check is scored only
  // when a hand-placed pin exists, and is left unscored otherwise rather than counted as a failure.
  const pinned = Boolean(v.latlng?.latitude);
  add('latlng', 'Map pin', 'Basics', pinned ? 1 : 0,
    !seesProfile ? NO_LISTING
      : pinned ? 'Placed by hand, so customers are sent to the exact spot.'
      : 'Google places this one from the address. It is worth a look on Maps: if the marker is on the wrong door or unit, move it on the Google Business Profile website.',
    'manual', seesProfile && pinned);
  add('primary_category', 'Primary category', 'Basics', v.primaryCategory?.name ? 1 : 0,
    seesProfile ? `${v.primaryCategory?.displayName ?? 'None'}.` : NO_LISTING, 'llm', seesProfile);
  add('place_id', 'Verified and live', 'Basics', v.place_id ? 1 : 0,
    seesProfile ? (v.place_id ? 'Verified and showing on Google Maps.' : 'Not verified, so it does not show on Maps.') : NO_LISTING, 'manual', seesProfile);

  // ---------------- Reviews ----------------
  const rs = one<{ n: number; replied: number; recent: number; recentUnreplied: number; avg: number | null }>(
    `SELECT COUNT(*) AS n, SUM(CASE WHEN reply_comment IS NOT NULL AND reply_comment != '' THEN 1 ELSE 0 END) AS replied,
            SUM(CASE WHEN create_time >= datetime('now', '-90 days') THEN 1 ELSE 0 END) AS recent,
            SUM(CASE WHEN create_time >= datetime('now', '-90 days') AND (reply_comment IS NULL OR reply_comment = '') THEN 1 ELSE 0 END) AS recentUnreplied,
            AVG(CASE WHEN rating > 0 THEN rating END) AS avg
     FROM reviews WHERE location_id = ?`, l.id,
  ) ?? { n: 0, replied: 0, recent: 0, recentUnreplied: 0, avg: null };
  // Public listing: Google's total and average; the stored rows are only the newest 20.
  const total = source === 'public' ? (pub!.listing.ratingCount ?? rs.n) : rs.n;
  const rating = source === 'public' ? pub!.listing.rating : (rs.avg ? Math.round(rs.avg * 10) / 10 : null);
  const sampled = rs.n > 0;                       // could we read individual reviews at all?
  const hasReviews = total > 0;

  const target = market ? Math.max(20, market.stats.packAvgReviews!) : 200;
  add('review_count', 'Number of reviews', 'Reviews', logScale(total, target),
    !seesProfile ? NO_LISTING
      : market ? `${total} reviews. The first three businesses Google Maps shows for "${market.query}" average ${market.stats.packAvgReviews}.`
      : `${total} reviews. Around 200 is strong for most local businesses.`,
    'manual', seesProfile);

  add('rating', 'Star rating', 'Reviews', hasReviews && rating != null ? ratingPoints(bayes(rating, total)) : 0,
    !seesProfile ? NO_LISTING
      : !hasReviews ? 'No reviews yet.'
      : `${rating}★ from ${total} review${total === 1 ? '' : 's'}.` +
        (total < 20 ? ' With so few reviews, a single bad one would pull this down sharply.' : '') +
        (market?.stats.medianRating != null ? ` Local competitors’ median is ${market.stats.medianRating}★.` : ''),
    'manual', seesProfile && hasReviews && rating != null);

  add('review_velocity', 'New reviews (last 90 days)', 'Reviews', (rs.recent ?? 0) / 12,
    !seesProfile ? NO_LISTING
      : !sampled ? 'Recent reviews could not be read.'
      : rs.recent ? `${rs.recent} in the last 90 days. About one a week keeps a profile looking active.`
      : 'No new reviews in the last 90 days, which makes the profile look quiet next to active competitors.',
    'manual', seesProfile && (sampled || !hasReviews));

  const replyRate = rs.n ? (rs.replied ?? 0) / rs.n : 0;
  add('reviews_replied', 'Replies to reviews', 'Reviews', replyRate,
    !seesProfile ? NO_LISTING
      : `${rs.replied} of the ${rs.n} most recent have an owner reply (${Math.round(replyRate * 100)}%)` +
        (rs.recentUnreplied ? `; ${rs.recentUnreplied} from the last 90 days are still waiting.` : '.'),
    'api', seesProfile && sampled);

  // ---------------- Categories ----------------
  const extra = v.additionalCategories.length;
  add('additional_categories', 'Additional categories', 'Categories', extra / 5,
    !seesProfile ? NO_LISTING
      : extra ? `${extra} extra categor${extra === 1 ? 'y' : 'ies'} set (up to 9). Each one that genuinely fits adds searches the business can appear in.`
      : 'Only the primary category is set. Every extra category that genuinely fits adds searches the business can appear in.',
    'llm', seesProfile);

  // ---------------- Profile ----------------
  const days = new Set(v.hoursPeriods.map((p: any) => p.openDay)).size;
  add('hours', 'Opening hours', 'Profile', days / 5,
    seesProfile ? (days ? `${days} days set.` : 'No hours set, so Google shows "hours unknown".') : NO_LISTING, 'manual', seesProfile);
  const desc = (v.description ?? '').trim();
  add('description', 'Business description', 'Profile', desc.length / 250,
    !seesPrivate ? hiddenPrivate : desc.length ? `${desc.length} of 750 characters. Front-load services and towns in the first 250.` : 'Empty. Up to 750 characters; the first 250 show before "More".',
    'llm', seesPrivate);
  const svc = v.serviceNames.length;
  add('services', 'Services list', 'Profile', svc / 8,
    seesPrivate ? `${svc} services listed. Each one is a phrase Google matches against searches.` : hiddenPrivate, 'llm', seesPrivate);
  if (seesPrivate && l.photos_synced_at) {
    // Half the points for having 10 or more, half for adding one recently (full within 30 days).
    const n = l.photos_count ?? 0;
    const days = l.photos_latest_at ? (Date.now() - Date.parse(l.photos_latest_at)) / 86_400_000 : Infinity;
    const recent = days <= 30 ? 1 : days <= 90 ? 0.5 : 0;
    const ago = !Number.isFinite(days) ? '' : days < 1 ? 'today' : days < 14 ? `${Math.round(days)} days ago` : days < 60 ? `${Math.round(days / 7)} weeks ago` : `${Math.round(days / 30)} months ago`;
    const cust = l.photos_customer_count ? `, plus ${l.photos_customer_count} from customers` : '';
    add('photos', 'Photos (10+, added monthly)', 'Profile', 0.5 * Math.min(1, n / 10) + 0.5 * recent,
      n === 0 ? `No photos added by the business yet${cust}. Add at least 10: outside, inside, the team and finished work.`
        : `${n} photo${n === 1 ? '' : 's'} added by the business${cust}; the newest ${ago}. Aim for 10 or more and a new one every month.`,
      'api', true);
  } else {
    add('photos', 'Photos (10+, added monthly)', 'Profile', 0,
      seesPrivate ? 'Not read yet. Photos are read with the daily checks, or press Re-read from Google.' : hiddenPrivate, 'api', false);
  }

  // ---------------- Activity ----------------
  const lastPost = one<{ posted_at: string }>(`SELECT posted_at FROM posts WHERE location_id = ? AND status = 'posted' ORDER BY posted_at DESC LIMIT 1`, l.id);
  const postAge = lastPost ? (Date.now() - new Date(lastPost.posted_at).getTime()) / 86_400_000 : Infinity;
  add('post_weekly', 'Google Post in the last week', 'Activity', postAge <= 7 ? 1 : postAge <= 14 ? 0.5 : 0,
    !seesPrivate ? hiddenPrivate : lastPost ? `Last post ${Math.round(postAge)} days ago.` : 'No post published from this app yet. Posts drop off the profile after 7 days.',
    'api', seesPrivate);

  // ---------------- Consistency ----------------
  const cit = one<{ found: number; mismatches: number }>('SELECT found, mismatches FROM citation_runs WHERE location_id = ? ORDER BY id DESC LIMIT 1', l.id);
  add('nap', 'Name, address and phone consistent across the web', 'Consistency',
    cit && cit.found ? ((cit.found - cit.mismatches) / cit.found) * Math.min(1, cit.found / 8) : 0,
    !cit ? 'Not checked yet: the other places this business is listed have not been looked at.'
      : `${cit.found} listings found, ${cit.mismatches} showing a different name, address or phone.` +
        (cit.found < 8 ? ' Few listings exist, so there is little for Google to cross-check.' : ''),
    'api', Boolean(cit));

  const known = items.filter(i => !i.unknown);
  const knownW = known.reduce((s, i) => s + i.weight, 0);
  const earned = known.reduce((s, i) => s + i.weight * i.points, 0);
  return { score: knownW ? Math.round((earned / knownW) * 100) : 0, items, source, coverage: Math.round(knownW) };
}

/** Group totals for display: "Reviews 31 / 40". */
export function groupTotals(items: AuditItem[]) {
  const order: AuditGroup[] = ['Reviews', 'Categories', 'Consistency', 'Profile', 'Activity', 'Basics'];
  return order.map(g => {
    const its = items.filter(i => i.group === g);
    const known = its.filter(i => !i.unknown);
    return {
      group: g,
      weight: its.reduce((s, i) => s + i.weight, 0),
      knownWeight: known.reduce((s, i) => s + i.weight, 0),
      earned: known.reduce((s, i) => s + i.weight * i.points, 0),
      items: its,
    };
  });
}
