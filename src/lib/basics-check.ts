/**
 * Checks for the business details form, shared by the browser (checks as you type) and the
 * server (checks again before anything is sent to Google). No imports, so it is safe in both.
 */

/** Check a UK-style phone number the way a person would read it, not a strict E.164 parser. */
export function checkPhone(raw: string): string | null {
  const p = raw.trim();
  if (!p) return 'Enter the phone number customers should call.';
  const digits = p.replace(/\D/g, '');
  if (/[^\d\s()+-]/.test(p) || digits.length < 10 || digits.length > 13) {
    return 'That does not look like a phone number. Use the format on the website, for example 01223 123456 or +44 1223 123456.';
  }
  return null;
}

/** Add https:// when it was left off, and reject anything that is not a web address. */
export function normaliseWebsite(raw: string): { value: string; error: string | null } {
  let w = raw.trim();
  if (!w) return { value: '', error: null };
  if (!/^https?:\/\//i.test(w)) w = `https://${w}`;
  try {
    const u = new URL(w);
    if (!u.hostname.includes('.')) throw new Error('no dot');
    // "macaws.ai" is stored as "https://macaws.ai"; a path, query or fragment is kept as typed.
    return { value: u.pathname === '/' && !u.search && !u.hash ? u.origin : u.toString(), error: null };
  } catch {
    return { value: w, error: 'That is not a web address. Use the full address, for example https://macaws.ai' };
  }
}
