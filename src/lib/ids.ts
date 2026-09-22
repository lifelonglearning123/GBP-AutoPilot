/**
 * Google ids look like 'locations/123' and travel as '123'. Manual businesses are 'manual/<slug>'
 * and travel URL-encoded whole; Next decodes the segment before it reaches the page.
 */
export const locParam = (id: string) => id.startsWith('locations/') ? id.slice('locations/'.length) : encodeURIComponent(id);
export function locId(param: string): string {
  const p = param.includes('%') ? decodeURIComponent(param) : param;
  return p.includes('/') ? p : `locations/${p}`;
}
