import { all, one, run, log } from './db';
import { json as llmJson } from './llm';
import { location, updateConfig, view, type LocationRow } from './locations';
import { createLocalPost, type GLocalPost } from './gbp';

export type PostRow = {
  id: number; location_id: string; summary: string; topic_type: string; cta_type: string | null; cta_url: string | null;
  media_url: string | null; angle: string | null; status: 'draft' | 'posted' | 'failed' | 'rejected'; google_name: string | null;
  error: string | null; posted_at: string | null; created_at: string;
};

export function posts(locationId: string): PostRow[] {
  return all<PostRow>('SELECT * FROM posts WHERE location_id = ? ORDER BY id DESC', locationId);
}
export function post(id: number): PostRow | undefined {
  return one<PostRow>('SELECT * FROM posts WHERE id = ?', id);
}

/** Rotating angles so 52 posts a year do not all read the same. */
const ANGLES = [
  'service spotlight: pick ONE service and explain who it is for and what happens on the day',
  'seasonal tip: practical advice tied to the current month in the UK, linked to a service',
  'customer story: paraphrase (never quote names) a recent positive review as a short before/after',
  'FAQ: answer one question customers ask before booking',
  'behind the scenes: how the team works, qualifications, guarantees, local roots',
  'local angle: something specific to the town or nearby areas served',
];

export function pickAngle(locationId: string): string {
  const n = one<{ n: number }>('SELECT COUNT(*) AS n FROM posts WHERE location_id = ?', locationId)?.n ?? 0;
  return ANGLES[n % ANGLES.length];
}

export async function generate(locationId: string, angle?: string): Promise<PostRow> {
  const l = location(locationId);
  if (!l) throw new Error('Unknown location');
  const v = view(l);
  const chosen = angle || pickAngle(locationId);
  const recent = all<{ rating: number; comment: string }>(
    `SELECT rating, comment FROM reviews WHERE location_id = ? AND rating >= 4 AND comment != '' ORDER BY create_time DESC LIMIT 5`, locationId);
  const previous = all<{ summary: string }>(`SELECT summary FROM posts WHERE location_id = ? ORDER BY id DESC LIMIT 6`, locationId);
  const month = new Date().toLocaleString('en-GB', { month: 'long' });

  const system = `You write weekly Google Business Profile posts for ${v.title}, a ${v.primaryCategory?.displayName ?? 'local business'} in ${v.town || 'the local area'}.
Voice: ${v.brand_voice || 'warm, plain, professional British English; sounds like the owner.'}
Rules for the post:
- 400 to 900 characters of plain text. No hashtags, no emojis, no ALL CAPS, no URLs in the text, no phone numbers.
- Mention the town (${v.town || 'the local town'}) and the service naturally, once or twice. This text is indexed, so name the service the way customers search for it.
- Start with a concrete first line, not "We are pleased to announce".
- End with a soft call to action that matches the button (e.g. "Tap Learn more to book").
- Do not repeat the angle or wording of previous posts.
Return JSON: { "summary": string, "cta": "LEARN_MORE" | "CALL" | "BOOK", "photo_brief": string (one line describing a photo the owner could add) }`;
  const user = [
    `Angle this week: ${chosen}`,
    `Month: ${month}`,
    `Services: ${[...new Set([...v.offeredServices, ...v.serviceNames])].join(', ') || 'general'}`,
    `Areas served: ${v.serviceAreas.join(', ') || v.town}`,
    `Website: ${v.website || 'none (use CALL)'}`,
    `Recent positive reviews:\n${recent.map(r => `- ${r.rating}★ ${r.comment}`).join('\n') || '(none)'}`,
    `Previous posts (avoid repeating):\n${previous.map(p => `- ${p.summary.slice(0, 120)}`).join('\n') || '(none)'}`,
  ].join('\n\n');

  const out = await llmJson<{ summary: string; cta: string; photo_brief?: string }>(system, user);
  const cta = ['LEARN_MORE', 'CALL', 'BOOK'].includes(out.cta) ? out.cta : (v.website ? 'LEARN_MORE' : 'CALL');
  const ctaUrl = cta === 'CALL' ? null : (v.website || null);
  const summary = String(out.summary ?? '').slice(0, 1500);
  const r = run(
    'INSERT INTO posts (location_id, summary, topic_type, cta_type, cta_url, angle) VALUES (?,?,?,?,?,?)',
    locationId, summary, 'STANDARD', (ctaUrl || cta === 'CALL') ? cta : null, ctaUrl, `${chosen}${out.photo_brief ? ` | photo: ${out.photo_brief}` : ''}`
  );
  return post(Number(r.lastInsertRowid))!;
}

/** The fields a person can edit on a draft. The patch comes from the browser, so its keys become column names only if listed here. */
const EDITABLE = new Set(['summary', 'cta_type', 'cta_url', 'media_url']);

export function edit(id: number, patch: Partial<Pick<PostRow, 'summary' | 'cta_type' | 'cta_url' | 'media_url'>>) {
  const keys = (Object.keys(patch ?? {}) as (keyof typeof patch)[]).filter(k => EDITABLE.has(k));
  if (!keys.length) return;
  run(`UPDATE posts SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ? AND status = 'draft'`, ...keys.map(k => patch[k] ?? null), id);
}
export function reject(id: number) { run(`UPDATE posts SET status = 'rejected' WHERE id = ?`, id); }

export async function publish(id: number): Promise<PostRow> {
  const p = post(id);
  if (!p) throw new Error('Unknown post');
  // Google makes a new post on every call, so an old tab or a second press must not post it twice.
  if (p.status === 'posted') throw new Error('This post is already on Google.');
  const l = location(p.location_id)!;
  const body: GLocalPost = { languageCode: l.language_code ?? 'en-GB', summary: p.summary, topicType: 'STANDARD' };
  if (p.cta_type === 'CALL') body.callToAction = { actionType: 'CALL' };
  else if (p.cta_type && p.cta_url) body.callToAction = { actionType: p.cta_type as any, url: p.cta_url };
  if (p.media_url) body.media = [{ mediaFormat: 'PHOTO', sourceUrl: p.media_url }];
  try {
    const g = await createLocalPost(l.account, l.id, body);
    run(`UPDATE posts SET status = 'posted', google_name = ?, posted_at = datetime('now'), error = NULL WHERE id = ?`, g.name ?? null, id);
    log('post', 'ok', p.summary.slice(0, 80), l.id);
  } catch (e: any) {
    run(`UPDATE posts SET status = 'failed', error = ? WHERE id = ?`, e.message, id);
    log('post', 'error', e.message, l.id);
    throw e;
  }
  return post(id)!;
}

/** Next occurrence of the location's chosen weekday and hour, strictly after `from`. */
export function nextPostAt(l: LocationRow, from = new Date()): string {
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setHours(l.post_hour, 0, 0, 0);
  const delta = (l.post_weekday - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + delta);
  if (d <= from) d.setDate(d.getDate() + 7);
  return d.toISOString();
}

/** Weekly job: generate, publish if on auto, and move the schedule on a week. */
export async function runWeekly(l: LocationRow): Promise<string> {
  const p = await generate(l.id);
  let detail = `drafted #${p.id}`;
  if (l.auto_post) { await publish(p.id); detail = `published #${p.id}`; }
  updateConfig(l.id, { next_post_at: nextPostAt(l) });
  return detail;
}
