import { all, one, run, log } from './db';
import { json as llmJson } from './llm';
import { location, view, type LocationView } from './locations';
import { isMock } from './gbp';
import { MOCK_CITATION_PAGES } from './mock';
import { normPhone, decodeEntities } from './nap';
import { ensureFresh } from './public';

/**
 * NAP citation audit (rule 3). Search the web for the business, pull every page that mentions
 * it, extract the name / address / phone that page shows, and diff against the profile.
 *
 * Read-only by design: the write path to directories is either a first-party API (Facebook,
 * Bing, Apple) or a white-label partner (Synup, BrightLocal). This audit is what tells you
 * where to point them, and what proves the sweep worked a month later.
 */

/** UK directories worth a claimed, consistent listing. Order roughly by how much Google leans on them. */
export const DIRECTORIES: { label: string; domains: string[]; claim: string }[] = [
  { label: 'Bing Places', domains: ['bingplaces.com', 'bing.com/maps'], claim: 'https://www.bingplaces.com/' },
  { label: 'Apple Maps', domains: ['maps.apple.com'], claim: 'https://businessconnect.apple.com/' },
  { label: 'Facebook', domains: ['facebook.com'], claim: 'https://www.facebook.com/pages/create' },
  { label: 'Yell', domains: ['yell.com'], claim: 'https://business.yell.com/free-listing/' },
  { label: 'Thomson Local', domains: ['thomsonlocal.com'], claim: 'https://www.thomsonlocal.com/add-business' },
  { label: 'Scoot', domains: ['scoot.co.uk'], claim: 'https://www.scoot.co.uk/add-business' },
  { label: 'Cylex', domains: ['cylex-uk.co.uk', 'cylex.co.uk'], claim: 'https://www.cylex-uk.co.uk/business/add' },
  { label: '192.com', domains: ['192.com'], claim: 'https://www.192.com/business/' },
  { label: 'FreeIndex', domains: ['freeindex.co.uk'], claim: 'https://www.freeindex.co.uk/add-business/' },
  { label: 'Hotfrog', domains: ['hotfrog.co.uk'], claim: 'https://www.hotfrog.co.uk/add-your-business' },
  { label: 'Yelp', domains: ['yelp.co.uk', 'yelp.com'], claim: 'https://biz.yelp.co.uk/' },
  { label: 'Checkatrade', domains: ['checkatrade.com'], claim: 'https://www.checkatrade.com/join' },
  { label: 'Trustpilot', domains: ['trustpilot.com', 'uk.trustpilot.com'], claim: 'https://business.trustpilot.com/' },
];

// Social profiles carry no NAP, and statutory registers use the legal entity name, so neither is a citation.
const IGNORE_DOMAINS = ['google.com', 'google.co.uk', 'youtube.com', 'linkedin.com/in/', 'instagram.com', 'tiktok.com', 'x.com', 'twitter.com',
  'ico.org.uk', 'companieshouse.gov.uk', 'company-information.service.gov.uk', 'endole.co.uk', 'companycheck.co.uk', 'opencorporates.com'];

export type Canonical = { name: string; phone: string; phoneDigits: string; postcode: string; street: string; town: string; website: string };

export type CitationRow = {
  id: number; run_id: number; location_id: string; url: string; domain: string; directory: string | null; page_title: string | null;
  name_found: string | null; phone_found: string | null; address_found: string | null;
  /** other = a different business that shares the name or number; shown, not counted as a mismatch. */
  status: 'match' | 'mismatch' | 'partial' | 'other' | 'not_listed' | 'error'; issues: string | null; created_at: string;
};
export type RunRow = { id: number; location_id: string; canonical_json: string; searched: number; found: number; matches: number; mismatches: number; ran_at: string };

export function latestRun(locationId: string): RunRow | undefined {
  return one<RunRow>('SELECT * FROM citation_runs WHERE location_id = ? ORDER BY id DESC LIMIT 1', locationId);
}
export function citations(runId: number): CitationRow[] {
  return all<CitationRow>(`SELECT * FROM citations WHERE run_id = ? ORDER BY CASE status WHEN 'mismatch' THEN 0 WHEN 'partial' THEN 1 WHEN 'match' THEN 2 WHEN 'other' THEN 3 WHEN 'not_listed' THEN 4 ELSE 5 END, directory IS NULL, domain`, runId);
}

export function canonical(v: LocationView): Canonical {
  return {
    name: v.title,
    phone: v.phone ?? '',
    phoneDigits: normPhone(v.phone ?? ''),
    postcode: (v.address.postalCode ?? '').toUpperCase().replace(/\s+/g, ''),
    street: (v.address.addressLines ?? []).join(', '),
    town: v.town,
    website: v.website ?? '',
  };
}

export { normPhone } from './nap';
/**
 * Names are compared with accents, punctuation, spacing, legal suffixes and the town stripped, so
 * "Bettys Café Tea Rooms, Harrogate" and "Bettys Cafe Tearooms" are the same name. A listing that
 * merely adds or drops words ("Bettys", "... & Shop") is a variant, not a mismatch: Google tolerates
 * those, and flagging them buries the real problems (wrong phone, old address).
 */
function normName(s: string, town = ''): string {
  let t = String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (town) t = t.replace(new RegExp(town.toLowerCase().replace(/[^a-z0-9 ]/g, ''), 'g'), ' ');
  return t.replace(/\b(ltd|limited|plc|llp|the|and|&)\b/g, ' ').replace(/[^a-z0-9]+/g, '');
}
function compareNames(expected: string, found: string, town: string): 'same' | 'variant' | 'different' {
  const a = normName(expected, town), b = normName(found, town);
  if (!a || !b || a === b) return 'same';
  if (a.includes(b) || b.includes(a)) return 'variant';
  // Shared prefix covering most of the shorter name ("bettyscafetearooms" vs "bettyscafetearoomsshop").
  const shorter = Math.min(a.length, b.length);
  let i = 0; while (i < shorter && a[i] === b[i]) i++;
  return i >= Math.max(6, Math.floor(shorter * 0.8)) ? 'variant' : 'different';
}
const normPostcode = (s: string) => String(s ?? '').toUpperCase().replace(/\s+/g, '');
const domainOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
const directoryFor = (url: string) => DIRECTORIES.find(d => d.domains.some(dom => url.replace(/^https?:\/\/(www\.)?/, '').startsWith(dom)))?.label ?? null;

// ---------- search ----------

type Hit = { link: string; title: string; snippet: string };

async function serper(q: string): Promise<Hit[]> {
  const key = process.env.SERPER_API_KEY?.trim();
  if (!key) throw new Error('SERPER_API_KEY is not set in .env.local (serper.dev, 2,500 free searches).');
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST', headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, gl: 'gb', hl: 'en', num: 10 }),
  });
  if (!res.ok) throw new Error(`Serper ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j: any = await res.json();
  return (j.organic ?? []).map((r: any) => ({ link: r.link, title: r.title ?? '', snippet: r.snippet ?? '' }));
}

function queries(c: Canonical): string[] {
  const qs = new Set<string>();
  if (c.phone) { qs.add(`"${c.phone}"`); const digits = c.phoneDigits; if (digits.length === 11) qs.add(`"${digits.slice(0, 5)} ${digits.slice(5)}"`); }
  qs.add(`"${c.name}" ${c.town}`);
  if (c.postcode) qs.add(`"${c.name}" "${c.postcode.slice(0, -3)} ${c.postcode.slice(-3)}"`);
  for (const d of DIRECTORIES.slice(0, 10)) qs.add(`site:${d.domains[0]} "${c.name}" ${c.town}`);
  return [...qs];
}

const MAX_PER_DOMAIN = 3;

async function discover(c: Canonical): Promise<Hit[]> {
  if (isMock() && !process.env.SERPER_API_KEY) {
    return Object.keys(MOCK_CITATION_PAGES).map(url => ({ link: url, title: MOCK_CITATION_PAGES[url].title, snippet: '' }));
  }
  const seen = new Map<string, Hit>();
  const perDomain = new Map<string, number>();
  for (const q of queries(c)) {
    try {
      for (const r of await serper(q)) {
        const u = r.link.split('#')[0];
        if (IGNORE_DOMAINS.some(d => u.includes(d))) continue;
        if (seen.has(u)) continue;
        // A site: query returns ten pages from one directory; three is enough to find the listing.
        const dom = domainOf(u);
        const n = perDomain.get(dom) ?? 0;
        if (n >= MAX_PER_DOMAIN) continue;
        perDomain.set(dom, n + 1);
        seen.set(u, { ...r, link: u });
      }
    } catch (e: any) {
      if (/SERPER_API_KEY/.test(e.message)) throw e;
      log('citations', 'error', `search "${q}": ${e.message}`);
    }
    if (seen.size >= 60) break;
  }
  return [...seen.values()];
}

// ---------- fetch + extract ----------

/**
 * Fetch the page; if the site refuses bots (Facebook, Yelp and most aggregators do), fall back to the
 * search snippet, which usually carries the name, town and phone anyway.
 */
async function pageText(hit: Hit): Promise<{ title: string; text: string; fromSnippet: boolean }> {
  const url = hit.link;
  if (isMock() && !process.env.SERPER_API_KEY) {
    const m = MOCK_CITATION_PAGES[url];
    if (!m) throw new Error('mock page missing');
    return { ...m, fromSnippet: false };
  }
  try {
    return { ...(await fetchPage(url)), fromSnippet: false };
  } catch (e) {
    if (hit.snippet) return { title: hit.title, text: `${hit.title}\n${hit.snippet}`, fromSnippet: true };
    throw e;
  }
}

async function fetchPage(url: string): Promise<{ title: string; text: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36', Accept: 'text/html' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? '';
    const text = html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d|address)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');
    // Entities decoded after tags are gone, so an encoded "<" in the text cannot become a tag.
    const decoded = decodeEntities(text).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
    return { title: decodeEntities(title), text: decoded };
  } finally { clearTimeout(t); }
}

type Relation = 'target' | 'other_business' | 'absent';
type Extracted = { relation: Relation; name: string | null; phone: string | null; address: string | null; notes?: string };

/** Only pages that plausibly mention the business go to the model; the rest are dropped as noise. */
function plausible(c: Canonical, text: string): boolean {
  const t = text.toLowerCase();
  const digits = normPhone(text.slice(0, 20000));
  const nameHit = normName(c.name).split(' ').filter(w => w.length > 2).every(w => t.includes(w));
  const phoneHit = c.phoneDigits.length >= 10 && digits.includes(c.phoneDigits);
  const pcHit = c.postcode.length >= 5 && normPostcode(text).includes(c.postcode);
  return nameHit || phoneHit || pcHit;
}

async function extract(c: Canonical, url: string, text: string): Promise<Extracted> {
  const system = `You check how ONE specific business appears on a web page, for a NAP (name, address, phone) consistency audit.
First decide the relation:
- "target": this page has an entry for the target business itself. Same business = same town or area (${c.town}) with a matching or similar name, OR the exact expected phone, OR the expected address. Small name variants (Ltd, punctuation, "Electricals" vs "Electrical" in the same town) still count as the target; a stale phone or an old address in the same town is still the target, that is exactly what we want to catch.
- "other_business": a business with the same or similar name in a clearly different town or region; a different business that happens to show the expected phone number; OR another branch of the same chain: an entry whose phone AND street address BOTH differ from the expected ones and which is a real separate site (e.g. "Bettys - Harlow Carr" at Crag Lane when the target is Parliament Street). A listing that shares the expected phone or the expected street address is always "target", even if the other field is wrong: that is the inconsistency we are hunting.
- "absent": the target is not on this page at all.
Then, for "target" and "other_business", copy the name, phone and address EXACTLY as the page shows them. Do not correct or normalise anything. If the page lists many businesses, report only the relevant entry.
Return JSON: { "relation": "target"|"other_business"|"absent", "name": string|null, "phone": string|null, "address": string|null (single line, as shown), "notes": string (one short line, e.g. "old phone number", "previous address", "same name, different town", "different branch", "shares our phone number") }`;
  const user = `Target business: ${c.name}\nExpected phone: ${c.phone}\nExpected address: ${c.street}, ${c.town}, ${c.postcode}\n\nPage: ${url}\n\n${text.slice(0, 9000)}`;
  const out = await llmJson<Extracted>(system, user);
  const relation: Relation = out.relation === 'target' || out.relation === 'other_business' ? out.relation : 'absent';
  // Snippets and model output can still carry entities ("J&#039;s"); decode before comparing names.
  const clean = (x: unknown) => (x == null || x === '' ? null : decodeEntities(String(x)).trim());
  return { relation, name: clean(out.name), phone: clean(out.phone), address: clean(out.address), notes: out.notes ? decodeEntities(out.notes) : undefined };
}

function judge(c: Canonical, e: Extracted): { status: CitationRow['status']; issues: string[] } {
  if (e.relation === 'absent') return { status: 'not_listed', issues: [] };
  if (e.relation === 'other_business') return { status: 'other', issues: [] };
  const issues: string[] = [];
  const soft: string[] = [];
  if (e.name) {
    const cmp = compareNames(c.name, e.name, c.town);
    if (cmp === 'different') issues.push(`name "${e.name}"`);
    else if (cmp === 'variant') soft.push(`name variant "${e.name}"`);
  }
  // Search snippets cut numbers off ("01793 3..."). A partial number can neither prove a mismatch
  // nor confirm a match, so it is treated as if no phone were shown.
  const truncated = Boolean(e.phone) && (/\.\.\.|…/.test(e.phone!) || normPhone(e.phone!).length < 10);
  const phone = truncated ? null : e.phone;
  if (truncated) soft.push(`phone cut off in the search result (${e.phone})`);
  if (phone && normPhone(phone) !== c.phoneDigits) issues.push(`phone ${phone}`);
  if (e.address) {
    const pc = /[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i.exec(e.address)?.[0];
    if (pc && normPostcode(pc) !== c.postcode) issues.push(`postcode ${pc.toUpperCase()}`);
    else if (!pc && c.postcode) soft.push('no postcode shown');
  }
  if (issues.length) return { status: 'mismatch', issues: [...issues, ...soft] };
  if (!phone || !e.address) return { status: 'partial', issues: [!phone && !truncated ? 'no phone shown' : '', !e.address ? 'no address shown' : '', ...soft].filter(Boolean) };
  return { status: 'match', issues: soft };
}

// ---------- run ----------

export async function audit(locationId: string, concurrency = 5): Promise<RunRow> {
  // Hand-added business: read its public Google listing first, so the reference name, address and
  // phone are what Google shows rather than whatever was typed in.
  await ensureFresh(locationId);
  const l = location(locationId);
  if (!l) throw new Error('Unknown location');
  const v = view(l);
  const c = canonical(v);
  if (!c.phone && !c.postcode) throw new Error('The profile has no phone or postcode to compare against. Sync it first.');

  const found = await discover(c);
  const r = run('INSERT INTO citation_runs (location_id, canonical_json, searched) VALUES (?,?,?)', locationId, JSON.stringify(c), found.length);
  const runId = Number(r.lastInsertRowid);

  let i = 0, matches = 0, mismatches = 0, listed = 0;
  const directoryNoted = new Set<string>();
  const worker = async () => {
    while (i < found.length) {
      const hit = found[i++];
      const url = hit.link;
      const domain = domainOf(url);
      const directory = directoryFor(url);
      try {
        const page = await pageText(hit);
        if (!plausible(c, page.text)) continue;               // search noise
        const e = await extract(c, url, page.text);
        const j = judge(c, e);
        if (j.status === 'not_listed') {                        // at most one "not listed" row, and only for key directories
          if (!directory || directoryNoted.has(directory)) continue;
          directoryNoted.add(directory);
        }
        if (j.status === 'match') matches++;
        if (j.status === 'mismatch') mismatches++;
        if (j.status === 'match' || j.status === 'mismatch' || j.status === 'partial') listed++;
        // The model's one-line note is useful context on a mismatch ("old phone number", "previous
        // address"); on consistent or incomplete rows it only restates the status ("matches target").
        const note = j.status === 'mismatch' && e.notes && !/^(match|same|consistent)/i.test(e.notes.trim()) ? [e.notes] : [];
        const notes = [...j.issues, ...note, ...(page.fromSnippet ? ['read from search snippet; page blocks bots'] : [])];
        run(`INSERT INTO citations (run_id, location_id, url, domain, directory, page_title, name_found, phone_found, address_found, status, issues)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          runId, locationId, url, domain, directory, page.title || hit.title, e.name, e.phone, e.address, j.status, JSON.stringify(notes));
      } catch (err: any) {
        if (directory && !directoryNoted.has(directory)) {
          directoryNoted.add(directory);
          run(`INSERT INTO citations (run_id, location_id, url, domain, directory, page_title, status, issues) VALUES (?,?,?,?,?,?,?,?)`,
            runId, locationId, url, domain, directory, hit.title, 'error', JSON.stringify([err.message]));
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, found.length || 1) }, worker));

  run('UPDATE citation_runs SET found = ?, matches = ?, mismatches = ? WHERE id = ?', listed, matches, mismatches, runId);
  log('citations', 'ok', `${found.length} pages searched, ${listed} citations, ${matches} match, ${mismatches} mismatch`, locationId);
  return one<RunRow>('SELECT * FROM citation_runs WHERE id = ?', runId)!;
}

/** Key directories with no citation in the run, with where to claim them. */
export function missingDirectories(runId: number) {
  const have = new Set(all<{ directory: string }>(`SELECT DISTINCT directory FROM citations WHERE run_id = ? AND directory IS NOT NULL AND status IN ('match','mismatch','partial')`, runId).map(x => x.directory));
  return DIRECTORIES.filter(d => !have.has(d.label));
}
