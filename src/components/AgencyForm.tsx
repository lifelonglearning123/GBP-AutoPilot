'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { callAction } from './Action';

type A = { name: string; website: string; email: string; phone: string; logo_url: string; colour: string; ghl_location_id: string; ghl_pipeline_id: string; ghl_stage_id: string; ghl_tag: string; ghl_token_set: boolean };
type Pipeline = { id: string; name: string; stages: { id: string; name: string }[] };

export default function AgencyForm({ a }: { a: A }) {
  const [f, setF] = useState({ ...a, ghl_token: '' });
  const [pipes, setPipes] = useState<Pipeline[] | null>(null);
  const [msg, setMsg] = useState('');
  const router = useRouter();
  const set = (k: string, v: string) => setF({ ...f, [k]: v });

  async function save() {
    setMsg('Saving…');
    const patch: Record<string, string> = { ...f } as any;
    delete (patch as any).ghl_token_set;
    if (!f.ghl_token) delete patch.ghl_token;     // blank means keep the stored token
    try { await callAction('agency.save', { patch }); setMsg('Saved'); router.refresh(); }
    catch (e: any) { setMsg(e.message); }
  }
  async function loadPipelines() {
    setMsg('Loading pipelines…');
    try { await save(); setPipes(await callAction<Pipeline[]>('ghl.pipelines')); setMsg(''); }
    catch (e: any) { setMsg(e.message); }
  }
  const stages = pipes?.find(p => p.id === f.ghl_pipeline_id)?.stages ?? [];

  return (
    <div className="flex flex-col gap-5">
      <section className="panel p-5 flex flex-col gap-3">
        <h2 className="font-semibold">Agency branding (on reports)</h2>
        <div className="grid grid-cols-2 gap-3">
          {([['name', 'Agency name'], ['website', 'Website'], ['email', 'Email'], ['phone', 'Phone'], ['logo_url', 'Logo URL (public)'], ['colour', 'Brand colour (hex)']] as const).map(([k, label]) => (
            <div key={k}><label className="field">{label}</label><input type="text" value={(f as any)[k]} onChange={e => set(k, e.target.value)} /></div>
          ))}
        </div>
      </section>

      <section className="panel p-5 flex flex-col gap-3">
        <h2 className="font-semibold">GoHighLevel</h2>
        <p className="text-xs muted">Sub-account → Settings → Private Integrations → create one with contacts, opportunities and medias scopes. Each push upserts a contact, uploads the report to the Media Library, adds a note, and creates an opportunity if a stage is chosen.</p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="field">Sub-account location id</label><input type="text" value={f.ghl_location_id} onChange={e => set('ghl_location_id', e.target.value)} /></div>
          <div><label className="field">Private integration token {a.ghl_token_set && <span className="pill good">set</span>}</label><input type="password" value={f.ghl_token} onChange={e => set('ghl_token', e.target.value)} placeholder={a.ghl_token_set ? 'leave blank to keep' : 'pit-…'} /></div>
          <div><label className="field">Tag for pushed contacts</label><input type="text" value={f.ghl_tag} onChange={e => set('ghl_tag', e.target.value)} /></div>
          <div className="flex items-end"><button className="btn" onClick={loadPipelines}>Load pipelines</button></div>
          <div>
            <label className="field">Pipeline</label>
            {pipes ? <select value={f.ghl_pipeline_id} onChange={e => set('ghl_pipeline_id', e.target.value)}><option value="">— none (contact + note only) —</option>{pipes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              : <input type="text" value={f.ghl_pipeline_id} onChange={e => set('ghl_pipeline_id', e.target.value)} placeholder="pipeline id" />}
          </div>
          <div>
            <label className="field">Stage</label>
            {pipes ? <select value={f.ghl_stage_id} onChange={e => set('ghl_stage_id', e.target.value)}><option value="">—</option>{stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              : <input type="text" value={f.ghl_stage_id} onChange={e => set('ghl_stage_id', e.target.value)} placeholder="stage id" />}
          </div>
        </div>
      </section>

      <div className="flex items-center gap-3"><button className="btn primary" onClick={save}>Save</button><span className="text-sm muted">{msg}</span></div>
    </div>
  );
}
