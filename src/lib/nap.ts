/**
 * Name / address / phone normalisers shared by the citation audit and the public-listing matcher.
 * Kept in their own module so citations.ts and public.ts can both use them without importing
 * each other.
 */

/** UK numbers to a single comparable form: "+44 (0) 1423 814070", "01423814070" → "01423814070". */
export function normPhone(s: string): string {
  // "+44 (0) 1423 814070" carries the trunk zero inside brackets; drop it before counting digits.
  let d = String(s ?? '').replace(/\(\s*0\s*\)/g, '').replace(/\D/g, '');
  if (d.startsWith('0044')) d = d.slice(4);
  // 44 then nine or ten digits: 0800 800150, 01204 62345 and 016977 3555 have nine after the 0.
  else if (d.startsWith('44') && d.length >= 11) d = d.slice(2);
  else if (d.startsWith('0')) d = d.slice(1);
  return d ? '0' + d : '';
}

export const normPostcode = (s: string) => String(s ?? '').toUpperCase().replace(/\s+/g, '');

/** Whole words only, and never "W1 1st" out of "Suite W1 1st Floor": that is a floor, not a postcode. */
export const POSTCODE_RE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b(?!\s+fl(?:oor|r)?\b)/i;

/** Accents, punctuation, spacing, legal suffixes and (optionally) the town stripped. */
export function normName(s: string, town = ''): string {
  let t = String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (town) t = t.replace(new RegExp(town.toLowerCase().replace(/[^a-z0-9 ]/g, ''), 'g'), ' ');
  return t.replace(/\b(ltd|limited|plc|llp|the|and|&)\b/g, ' ').replace(/[^a-z0-9]+/g, '');
}

export const hostOf = (url: string | null | undefined) => {
  try { return new URL(String(url)).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
};

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', pound: '£', copy: '©', reg: '®', trade: '™' };

/**
 * Decode HTML entities, numeric ones included. Sites write the apostrophe as &#39;, &#039; or
 * &#x27;; missing any of them turned "J's Electrical" into "J&#039;s Electrical", which the name
 * comparison then flagged as a different business.
 */
export function decodeEntities(s: string): string {
  return String(s ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}
function safeChar(code: number): string {
  try { return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''; } catch { return ''; }
}
