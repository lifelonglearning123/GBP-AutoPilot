import { run, parse, log } from './db';
import { location, view, type LocationRow } from './locations';

/**
 * Where a business sits on the map.
 *
 * Google's own `latlng` is only handed to the API when somebody placed the pin by hand on the Google
 * Business Profile website ("can only be updated by approved clients", and ignored at create when the
 * address geocodes). Most profiles therefore arrive without one, and the map grid needs a centre all
 * the same. So when Google gives no pin, the address is turned into a position once and kept: first
 * with OpenStreetMap, then with the UK postcode service. Both are free and need no key.
 *
 * The worked-out position is stored apart from `latlng_json`, so the audit can still tell whether a
 * real pin exists, and a map run always records the centre it used.
 */
export type Centre = { lat: number; lng: number; source: 'pin' | 'address' | 'postcode' };

const SOURCE_NOTE: Record<Centre['source'], string> = {
  pin: 'the map pin on the Google profile',
  address: 'the address, looked up on OpenStreetMap',
  postcode: 'the middle of the postcode',
};
export const centreNote = (c: Centre) => SOURCE_NOTE[c.source];

/** The position already known for this business, without asking anyone. */
export function storedCentre(l: LocationRow): Centre | null {
  const pin = view(l).latlng;
  if (pin?.latitude != null && pin?.longitude != null) return { lat: pin.latitude, lng: pin.longitude, source: 'pin' };
  const geo = parse<{ lat: number; lng: number; source: Centre['source'] } | null>(l.geo_json, null);
  return geo ? { lat: geo.lat, lng: geo.lng, source: geo.source } : null;
}

const ok = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

async function fromOpenStreetMap(q: string, country: string): Promise<Centre | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=${encodeURIComponent(country.toLowerCase())}&q=${encodeURIComponent(q)}`;
  // OpenStreetMap asks callers to identify themselves and to keep it to one request a second. This
  // runs once per business, on the first map view, so it stays well inside that.
  const r = await fetch(url, { headers: { 'User-Agent': 'GBP-Autopilot/1.0 (local SEO tool)', 'Accept-Language': 'en-GB' } });
  if (!r.ok) throw new Error(`OpenStreetMap answered ${r.status}`);
  const j = (await r.json()) as { lat?: string; lon?: string }[];
  const hit = j?.[0];
  if (!hit?.lat || !hit?.lon) return null;
  const lat = Number(hit.lat), lng = Number(hit.lon);
  return ok(lat, lng) ? { lat, lng, source: 'address' } : null;
}

async function fromPostcode(postcode: string): Promise<Centre | null> {
  const r = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.trim())}`);
  if (!r.ok) return null;
  const j = (await r.json()) as { result?: { latitude?: number; longitude?: number } };
  const lat = j.result?.latitude, lng = j.result?.longitude;
  return lat != null && lng != null && ok(lat, lng) ? { lat, lng, source: 'postcode' } : null;
}

/**
 * The position to centre a map on, working it out from the address the first time it is needed.
 * Returns null only when there is no pin and nothing in the address to go on.
 */
export async function ensureCentre(id: string): Promise<Centre | null> {
  const l = location(id);
  if (!l) return null;
  const known = storedCentre(l);
  if (known) return known;

  const v = view(l);
  const country = v.address.regionCode ?? 'GB';
  const postcode = v.address.postalCode ?? '';
  const q = [...(v.address.addressLines ?? []), v.address.locality, v.address.administrativeArea, postcode].filter(Boolean).join(', ');
  let found: Centre | null = null;
  try {
    if (q) found = await fromOpenStreetMap(q, country);
    if (!found && postcode && country.toUpperCase() === 'GB') found = await fromPostcode(postcode);
  } catch (e: any) {
    log('geo', 'error', `${l.title}: ${e?.message ?? e}`, l.id);
    // A postcode lookup is worth trying even when OpenStreetMap is having a bad day.
    if (postcode && country.toUpperCase() === 'GB') { try { found = await fromPostcode(postcode); } catch { /* give up quietly */ } }
  }
  if (!found) {
    log('geo', 'error', `${l.title}: no map pin, and the address could not be placed`, l.id);
    return null;
  }
  run(`UPDATE locations SET geo_json = ?, geo_at = datetime('now') WHERE id = ?`, JSON.stringify(found), l.id);
  log('geo', 'ok', `${l.title}: placed from ${SOURCE_NOTE[found.source]}`, l.id);
  return found;
}

/** Forget a worked-out position, so the next map view looks it up again (after an address change). */
export function clearCentre(id: string) { run(`UPDATE locations SET geo_json = NULL, geo_at = NULL WHERE id = ?`, id); }
