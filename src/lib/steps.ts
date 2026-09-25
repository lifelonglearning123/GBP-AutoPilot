import type { AuditItem, AuditGroup } from './audit';

/** Scoring areas in the words a business owner would use. The stored group names stay as they are. */
export const GROUP_LABEL: Record<AuditGroup, string> = {
  Reviews: 'Reviews',
  Categories: 'Categories',
  Consistency: 'Details elsewhere',
  Profile: 'Profile details',
  Activity: 'Posts and photos',
  Basics: 'The basics',
};

/** How the profile is doing overall, said in words rather than a number. */
export function verdict(score: number, partial = false): { word: string; colour: string } {
  if (partial) return { word: 'Partly checked', colour: 'var(--muted)' };
  if (score >= 80) return { word: 'In good shape', colour: 'var(--good)' };
  if (score >= 50) return { word: 'A few things to fix', colour: 'var(--warn)' };
  return { word: 'Needs attention', colour: 'var(--bad)' };
}

/** What to do, in the words of someone doing it, rather than the name of the check. */
export const TODO: Record<string, string> = {
  phone: 'Add a phone number',
  website: 'Add a website',
  hours: 'Set opening hours for every day you open',
  description: 'Write a fuller description',
  services: 'List more of the services you offer',
  additional_categories: 'Add more categories',
  primary_category: 'Choose a primary category',
  review_count: 'Get more reviews',
  review_velocity: 'Get new reviews every month',
  rating: 'Lift the star rating',
  reviews_replied: 'Reply to every review',
  post_weekly: 'Publish a post every week',
  nap: 'Make the name, address and phone match everywhere',
  photos: 'Add new photos every month',
  place_id: 'Get the profile verified',
  title: 'Add the business name',
  address: 'Add the address or service area',
};

/** Points still available on a check. */
export const atStake = (i: AuditItem) => i.weight * (1 - i.points);

/** Points in whole numbers, for anything a business owner reads. Fractions belong in the checklist. */
export const worth = (n: number) => { const r = Math.round(n); return `${r} point${r === 1 ? '' : 's'}`; };

/** The failing checks a person can act on, biggest gain first (shared by the dashboard and Next steps). */
export function nextSteps(items: AuditItem[]): AuditItem[] {
  return items.filter(i => !i.unknown && !i.ok).sort((a, b) => atStake(b) - atStake(a));
}
