import fs from 'node:fs';
import path from 'node:path';
import { log } from './db';
import { location, view, updateConfig, type LocationRow } from './locations';
import { agency } from './agency';
import { audit } from './audit';
import { latestRun } from './citations';
import * as report from './report';

/**
 * GoHighLevel push: the audited business becomes a contact in the agency sub-account, the report
 * goes into the Media Library so there is a shareable link, a note carries the findings, and an
 * opportunity lands in the chosen pipeline stage. Needs a Private Integration token with
 * contacts, opportunities and medias scopes.
 */
const API = 'https://services.leadconnectorhq.com';
const VERSION = '2021-07-28';

function headers(extra: Record<string, string> = {}) {
  const a = agency();
  if (!a.ghl_token || !a.ghl_location_id) throw new Error('GHL is not configured. Add the sub-account location id and a Private Integration token on Settings.');
  return { Authorization: `Bearer ${a.ghl_token}`, Version: VERSION, Accept: 'application/json', ...extra };
}

async function api<T = any>(pathname: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${pathname}`, { ...init, headers: { ...headers(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(init.headers ?? {}) } });
  const text = await res.text();
  const json = text ? (() => { try { return JSON.parse(text); } catch { return { raw: text }; } })() : {};
  if (!res.ok) throw new Error(`GHL ${res.status}: ${json?.message ?? json?.error ?? text.slice(0, 200)}`);
  return json as T;
}

export async function pipelines(): Promise<{ id: string; name: string; stages: { id: string; name: string }[] }[]> {
  const a = agency();
  const j = await api<any>(`/opportunities/pipelines?locationId=${encodeURIComponent(a.ghl_location_id)}`);
  return (j.pipelines ?? []).map((p: any) => ({ id: p.id, name: p.name, stages: (p.stages ?? []).map((s: any) => ({ id: s.id, name: s.name })) }));
}

async function uploadReport(file: string, name: string): Promise<string | null> {
  try {
    const fd = new FormData();
    fd.append('file', new Blob([fs.readFileSync(file)], { type: 'text/html' }), path.basename(file));
    fd.append('name', name);
    const j = await api<any>('/medias/upload-file', { method: 'POST', body: fd });
    return j?.url ?? j?.fileUrl ?? null;
  } catch (e: any) {
    log('ghl', 'error', `media upload: ${e.message}`);
    return null;
  }
}

export async function push(locationId: string, opts: { pipelineId?: string; stageId?: string } = {}): Promise<{ contactId: string; reportUrl: string | null; opportunityId: string | null }> {
  const l = location(locationId);
  if (!l) throw new Error('Unknown location');
  const a = agency();
  // Regenerate first: for a hand-added business this also refreshes the public Google listing,
  // so the score, the note and the contact details below all use Google's current data.
  const rep = await report.build(l.id);
  const fresh = location(locationId)!;
  const v = view(fresh);
  const { score, items } = audit(fresh);
  const run = latestRun(fresh.id);
  const reportUrl = await uploadReport(rep.file, `Local SEO audit - ${v.title}`);

  const [first, ...rest] = v.title.split(' ');
  const contact = await api<any>('/contacts/upsert', {
    method: 'POST',
    body: JSON.stringify({
      locationId: a.ghl_location_id,
      firstName: first, lastName: rest.join(' ') || '-',
      companyName: v.title,
      phone: v.phone || undefined,
      website: v.website || undefined,
      address1: (v.address.addressLines ?? []).join(', ') || undefined,
      city: v.town || undefined,
      state: v.address.administrativeArea || undefined,
      postalCode: v.address.postalCode || undefined,
      country: v.address.regionCode || 'GB',
      source: 'GBP Autopilot audit',
      tags: [a.ghl_tag || 'gbp-audit'],
    }),
  });
  const contactId: string = contact?.contact?.id ?? contact?.id;
  if (!contactId) throw new Error('GHL did not return a contact id');

  const failing = items.filter(i => !i.ok && !i.unknown).map(i => `- ${i.label}: ${i.note}`);
  const note = [
    `Local SEO audit: ${score}/100 (${new Date().toLocaleDateString('en-GB')})`,
    rep.data.summary.headline,
    '',
    'Findings:', ...rep.data.summary.findings.map(f => `- ${f}`),
    '',
    'Do first:', ...rep.data.summary.actions.map((x, i) => `${i + 1}. ${x}`),
    '',
    run ? `Citations: ${run.found} found, ${run.matches} consistent, ${run.mismatches} wrong. Missing: ${rep.data.citations.missing.map(m => m.label).join(', ') || 'none'}` : 'Citation audit not run.',
    '',
    'Checklist failing:', ...failing,
    '',
    reportUrl ? `Full report: ${reportUrl}` : `Full report (local file): ${rep.file}`,
  ].join('\n');
  await api(`/contacts/${contactId}/notes`, { method: 'POST', body: JSON.stringify({ body: note.slice(0, 5000) }) });

  let opportunityId: string | null = null;
  const pipelineId = opts.pipelineId || a.ghl_pipeline_id;
  const stageId = opts.stageId || a.ghl_stage_id;
  if (pipelineId && stageId) {
    const opp = await api<any>('/opportunities/', {
      method: 'POST',
      body: JSON.stringify({
        locationId: a.ghl_location_id, pipelineId, pipelineStageId: stageId, contactId,
        name: `${v.title} · GBP audit ${score}/100`, status: 'open', source: 'GBP Autopilot',
      }),
    });
    opportunityId = opp?.opportunity?.id ?? opp?.id ?? null;
  }

  updateConfig(l.id, { ghl_contact_id: contactId, ghl_pushed_at: new Date().toISOString(), report_url: reportUrl ?? rep.file });
  log('ghl', 'ok', `contact ${contactId}${opportunityId ? `, opportunity ${opportunityId}` : ''}`, l.id);
  return { contactId, reportUrl, opportunityId };
}

/**
 * A bad-review alert in GoHighLevel: a task due tomorrow and a note with the review, on the
 * business's contact in the agency sub-account. Only businesses already pushed to GHL have a contact.
 */
export async function notifyBadReview(l: LocationRow, a: { title: string; detail: string; rating: number }): Promise<{ status: 'sent' | 'skipped'; detail: string }> {
  const ag = agency();
  if (!ag.ghl_token || !ag.ghl_location_id) return { status: 'skipped', detail: 'GoHighLevel is not set up on Settings.' };
  if (!l.ghl_contact_id) return { status: 'skipped', detail: 'Not pushed to GoHighLevel yet, so there is no contact to add the alert to.' };
  const due = new Date(Date.now() + 24 * 3_600_000).toISOString();
  await api(`/contacts/${l.ghl_contact_id}/tasks`, {
    method: 'POST',
    body: JSON.stringify({
      title: `Reply to the ${a.rating}-star Google review`,
      body: `${a.title}\n\n\u201c${a.detail}\u201d\n\nReply on the Reviews tab in GBP Autopilot, or in Google Business Profile.`,
      dueDate: due,
      completed: false,
    }),
  });
  await api(`/contacts/${l.ghl_contact_id}/notes`, { method: 'POST', body: JSON.stringify({ body: `${a.title}:\n\u201c${a.detail}\u201d` }) });
  log('ghl', 'ok', `Bad-review task and note added for ${l.title}`, l.id);
  return { status: 'sent', detail: 'Task and note added to the contact in GoHighLevel.' };
}
