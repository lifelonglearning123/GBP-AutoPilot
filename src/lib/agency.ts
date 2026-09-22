import { getSetting, setSetting } from './db';

/** Branding and integration settings for the agency running this app, stored in the settings table. */
export type Agency = {
  name: string; website: string; email: string; phone: string; logo_url: string; colour: string;
  ghl_location_id: string; ghl_token: string; ghl_pipeline_id: string; ghl_stage_id: string; ghl_tag: string;
};

const KEYS: (keyof Agency)[] = ['name', 'website', 'email', 'phone', 'logo_url', 'colour', 'ghl_location_id', 'ghl_token', 'ghl_pipeline_id', 'ghl_stage_id', 'ghl_tag'];

export function agency(): Agency {
  const a = {} as Agency;
  for (const k of KEYS) a[k] = getSetting(`agency.${k}`) ?? '';
  if (!a.colour) a.colour = '#1f5f8b';
  if (!a.ghl_tag) a.ghl_tag = 'gbp-audit';
  return a;
}

export function saveAgency(patch: Partial<Agency>) {
  for (const k of KEYS) if (k in patch) setSetting(`agency.${k}`, String(patch[k] ?? '').trim());
}

/** What the UI may see: never the token itself, only whether one is set. */
export function agencyPublic() {
  const a = agency();
  return { ...a, ghl_token: '', ghl_token_set: Boolean(a.ghl_token) };
}
