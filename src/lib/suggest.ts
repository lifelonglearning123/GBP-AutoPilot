import { all, one, run, parse, log } from './db';
import { json as llmJson } from './llm';
import { location, resync, view, type LocationRow } from './locations';
import { patchLocation, searchCategories, type GCategory } from './gbp';
import { mergeCategoryDraft } from './cat-merge';

export type Suggestion = {
  id: number; location_id: string; field: 'description' | 'categories' | 'services';
  proposal_json: string; rationale: string | null; status: string; error: string | null; created_at: string; applied_at: string | null;
};

export function suggestions(locationId: string): Suggestion[] {
  return all<Suggestion>('SELECT * FROM suggestions WHERE location_id = ? ORDER BY id DESC', locationId);
}

function businessContext(l: LocationRow): string {
  const v = view(l);
  return [
    `Business: ${v.title}`,
    `Town: ${v.town || 'unknown'}; full address: ${v.addressLine || 'n/a'}`,
    `Primary category: ${v.primaryCategory?.displayName ?? 'none'}`,
    `Additional categories: ${v.additionalCategories.map(c => c.displayName).join(', ') || 'none'}`,
    `Current description: ${v.description || '(empty)'}`,
    `Services on profile: ${v.serviceNames.join(', ') || 'none'}`,
    `Services the owner says they offer: ${v.offeredServices.join(', ') || 'not specified'}`,
    `Areas served: ${v.serviceAreas.join(', ') || 'not specified'}`,
    `Website: ${v.website || 'none'}`,
    `Brand voice notes: ${v.brand_voice || 'plain, friendly, professional British English'}`,
  ].join('\n');
}

/** Words that match hundreds of unrelated categories, so they only waste a search. */
const WEAK_WORDS = new Set([
  'service', 'services', 'company', 'store', 'shop', 'centre', 'center', 'with', 'from', 'your', 'their', 'that',
  'this', 'into', 'more', 'data', 'tools', 'tool', 'implementation', 'solutions', 'solution', 'local', 'best',
  'professional', 'expert', 'experts', 'quality', 'free', 'online', 'full', 'general', 'other',
]);

/**
 * Up to eight single words likely to appear in the NAMES of Google's categories for this business
 * ("marketing", "software", "consultant"). Words only: the category names still come from Google.
 */
async function proposeCategoryWords(l: LocationRow): Promise<string[]> {
  const out = await llmJson<{ words?: string[] }>(
    'You help find Google Business Profile categories. Given a business, list up to 8 single English words that are likely to appear in the names of Google Business Profile categories that describe what this business is or does (for example "marketing", "software", "consultant", "plumber", "electrician", "salon"). Prefer nouns used in category names. Return JSON: {"words": string[]}',
    businessContext(l),
  );
  return (out.words ?? []).map(w => String(w).trim()).filter(w => /^[a-z][a-z-]{2,}$/i.test(w)).slice(0, 8);
}

/**
 * Candidate categories from Google's own list, searched with words from four places: words the model
 * proposes, the categories the profile has now, the services on the Google profile, and the services
 * typed on the Settings tab. The model then picks from these; it never writes a category name.
 * (It used to search only the first word of the primary category plus the Configure services, which
 * for a profile with no Configure services meant a single search, "Internet", and five categories.)
 */
async function candidateCategories(l: LocationRow): Promise<GCategory[]> {
  const v = view(l);
  const terms = new Map<string, true>();
  const add = (raw: string) => {
    const w = raw.trim().toLowerCase().replace(/[^a-z-]/g, '');
    if (w.length >= 4 && !WEAK_WORDS.has(w)) terms.set(w, true);
  };
  try { for (const w of await proposeCategoryWords(l)) add(w); }
  catch (e: any) { log('categories', 'error', `search words: ${e.message}`, l.id); }
  for (const c of [v.primaryCategory, ...v.additionalCategories]) for (const w of (c?.displayName ?? '').split(/\s+/)) add(w);
  for (const svc of [...v.serviceNames, ...v.offeredServices]) for (const w of svc.split(/[\s,/&+]+/)) add(w);

  const seen = new Map<string, GCategory>();
  // Keep what the profile already has, so the draft can keep it without it being searched for.
  for (const c of [v.primaryCategory, ...v.additionalCategories]) if (c?.name) seen.set(c.name, { name: c.name, displayName: c.displayName ?? c.name } as GCategory);
  let searched = 0;
  for (const t of [...terms.keys()].slice(0, 14)) {
    try {
      for (const c of await searchCategories(v.region, v.lang, t)) seen.set(c.name, c);
      searched++;
    } catch (e: any) { log('categories', 'error', `"${t}": ${e.message}`, l.id); }
    if (seen.size > 220) break;
  }
  log('categories', 'ok', `${seen.size} candidate categories from ${searched} searches (${[...terms.keys()].slice(0, 14).join(', ')})`, l.id);
  return [...seen.values()];
}

/**
 * One LLM call proposes all three fixable fields. Categories are constrained to Google's own list
 * so nothing invented can reach the API; the LLM picks from candidates, it does not write names.
 */
export async function generate(locationId: string): Promise<Suggestion[]> {
  const l = location(locationId);
  if (!l) throw new Error('Unknown location');
  const cands = await candidateCategories(l);
  const v = view(l);

  const system = `You are a local SEO specialist optimising a Google Business Profile. Follow Google's guidelines strictly:
- The description is up to 750 characters, plain text, no URLs, no promotions, no ALL CAPS. Front-load what the business does and where (town names) in the first 250 characters. Written in British English, first person plural.
- Categories: choose ONLY from the candidate list provided, by exact "name". The primary must be the single most specific description of the core business. Add up to 9 additional categories the business genuinely qualifies for. Never add a category for something they do not do.
- Services: 8 to 15 short service names (2 to 5 words each) that customers actually search for, matching the offered services. No towns in service names.
Return JSON: {
  "description": string,
  "description_rationale": string,
  "primary_category": string (candidate name),
  "additional_categories": string[] (candidate names),
  "categories_rationale": string,
  "services": string[],
  "services_rationale": string
}`;
  const user = `${businessContext(l)}\n\nCandidate categories (name | displayName):\n${cands.map(c => `${c.name} | ${c.displayName}`).join('\n') || '(none found; keep current categories)'}`;

  const out = await llmJson<any>(system, user);
  const byName = new Map(cands.map(c => [c.name, c]));
  // Models sometimes answer with the display name despite being asked for the id; accept both.
  const byDisplay = new Map(cands.map(c => [c.displayName.toLowerCase(), c.name]));
  const resolveCat = (x: unknown): string | undefined => {
    const s = String(x ?? '').trim();
    return byName.has(s) ? s : byDisplay.get(s.toLowerCase());
  };
  const primaryName = resolveCat(out.primary_category) ?? v.primaryCategory?.name;
  const additional = [...new Set<string>((out.additional_categories ?? []).map(resolveCat).filter((n: string | undefined): n is string => Boolean(n) && n !== primaryName))].slice(0, 9);

  run(`DELETE FROM suggestions WHERE location_id = ? AND status = 'pending'`, locationId);
  const insert = (field: string, proposal: unknown, rationale: string) =>
    run('INSERT INTO suggestions (location_id, field, proposal_json, rationale) VALUES (?,?,?,?)', locationId, field, JSON.stringify(proposal), rationale);

  if (out.description) insert('description', String(out.description).slice(0, 750), out.description_rationale ?? '');
  if (primaryName) insert('categories', {
    primary: { name: primaryName, displayName: byName.get(primaryName)?.displayName ?? v.primaryCategory?.displayName },
    additional: additional.map((n: string) => ({ name: n, displayName: byName.get(n)!.displayName })),
  }, out.categories_rationale ?? '');
  if (Array.isArray(out.services) && out.services.length) insert('services', out.services.map(String).slice(0, 15), out.services_rationale ?? '');

  log('suggest', 'ok', 'generated', locationId);
  return suggestions(locationId);
}

export function editSuggestion(id: number, proposal: unknown) {
  run('UPDATE suggestions SET proposal_json = ? WHERE id = ? AND status = ?', JSON.stringify(proposal), id, 'pending');
}
export function rejectSuggestion(id: number) {
  run(`UPDATE suggestions SET status = 'rejected' WHERE id = ?`, id);
}

/** Write an approved suggestion to Google, then re-read the location so the audit reflects it. */
export async function apply(id: number): Promise<void> {
  const s = one<Suggestion>('SELECT * FROM suggestions WHERE id = ?', id);
  if (!s) throw new Error('Unknown suggestion');
  // Only a draft still waiting (or one whose save failed) is written. An old tab must not write a
  // draft a person rejected, or write an applied one over changes made since.
  if (s.status === 'rejected') throw new Error('This draft was rejected, so it was not written to Google.');
  if (s.status === 'applied') throw new Error('This draft has already been written to Google.');
  if (s.status !== 'pending' && s.status !== 'failed') throw new Error('This draft is not waiting to be approved.');
  const l = location(s.location_id);
  if (!l) throw new Error('Unknown location');
  const v = view(l);
  const proposal = parse<any>(s.proposal_json, null);

  try {
    if (s.field === 'description') {
      await patchLocation(l.id, { profile: { description: String(proposal) } }, ['profile.description']);
    } else if (s.field === 'categories') {
      // A draft adds, never removes: extras already on Google (perhaps added by hand after the draft
      // was written) are kept, and so is the old primary. Removing is done in the category picker.
      const merged = mergeCategoryDraft({ primary: v.primaryCategory ?? null, additional: v.additionalCategories }, proposal);
      await patchLocation(l.id, {
        categories: {
          primaryCategory: { name: merged.primary.name },
          additionalCategories: merged.additional.map(c => ({ name: c.name })),
        },
      }, ['categories']);
    } else if (s.field === 'services') {
      // Keep any structured items Google already has; free-form items are replaced wholesale.
      const existing = parse<any[]>(l.services_json, []).filter(i => i.structuredServiceItem);
      const category = v.primaryCategory?.name;
      if (!category) throw new Error('Set a primary category before adding services.');
      const lang = l.language_code ?? 'en-GB';
      const items = (proposal as string[]).map(name => ({ freeFormServiceItem: { category, label: { displayName: name, languageCode: lang } } }));
      await patchLocation(l.id, { serviceItems: [...existing, ...items] }, ['serviceItems']);
    }
    run(`UPDATE suggestions SET status = 'applied', applied_at = datetime('now'), error = NULL WHERE id = ?`, id);
    log('apply', 'ok', s.field, l.id);
  } catch (e: any) {
    run(`UPDATE suggestions SET status = 'failed', error = ? WHERE id = ?`, e.message, id);
    log('apply', 'error', `${s.field}: ${e.message}`, l.id);
    throw e;
  }
  await resync(l.id);
}
