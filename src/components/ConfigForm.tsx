'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { callAction } from './Action';

type Props = {
  l: {
    id: string; brand_voice: string; offered_services: string[]; service_areas: string[]; site_slug: string; site_colour: string;
    auto_reply: boolean; auto_post: boolean; post_weekday: number; post_hour: number; scheduled: boolean; profileServices: string[]; town: string;
    manual: ManualFields | null;
    photo_every_days: number;
  };
};
type ManualFields = { title: string; street: string; town: string; county: string; postcode: string; phone: string; website: string; category: string };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function ConfigForm({ l }: Props) {
  const [voice, setVoice] = useState(l.brand_voice);
  const [services, setServices] = useState(l.offered_services.join('\n'));
  const [areas, setAreas] = useState(l.service_areas.join('\n'));
  const [slug, setSlug] = useState(l.site_slug);
  const [colour, setColour] = useState(l.site_colour || '#1f5f8b');
  const [autoReply, setAutoReply] = useState(l.auto_reply);
  const [autoPost, setAutoPost] = useState(l.auto_post);
  const [weekday, setWeekday] = useState(l.post_weekday);
  const [hour, setHour] = useState(l.post_hour);
  const [scheduled, setScheduled] = useState(l.scheduled);
  const [msg, setMsg] = useState('');
  const [photoDays, setPhotoDays] = useState(l.photo_every_days);
  const [nap, setNap] = useState<ManualFields>(l.manual ?? { title: '', street: '', town: '', county: '', postcode: '', phone: '', website: '', category: '' });
  const router = useRouter();
  const lines = (s: string) => s.split('\n').map(x => x.trim()).filter(Boolean);

  async function save() {
    setMsg('Saving…');
    try {
      await callAction('location.config', { id: l.id, config: {
        brand_voice: voice, offered_services: JSON.stringify(lines(services)), service_areas: JSON.stringify(lines(areas)),
        site_slug: slug, site_colour: colour, auto_reply: autoReply ? 1 : 0, auto_post: autoPost ? 1 : 0, post_weekday: weekday, post_hour: hour, photo_every_days: photoDays,
      } });
      if (l.manual) await callAction('location.manual.save', { id: l.id, input: nap });
      await callAction('location.schedule', { id: l.id, enabled: scheduled });
      setMsg('Saved'); router.refresh();
    } catch (e: any) { setMsg(e.message); }
  }

  return (
    <div className="grid gap-5" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <section className="panel p-5 flex flex-col gap-4">
        <h2 className="font-semibold">About the business</h2>
        {l.manual && (
          <div className="grid grid-cols-2 gap-3 panel-2 p-3">
            <div className="col-span-2 text-xs muted">Canonical NAP (typed in by hand). Use the exact spelling that is on the signage and the website.</div>
            {(['title', 'street', 'town', 'county', 'postcode', 'phone', 'website', 'category'] as (keyof ManualFields)[]).map(k => (
              <div key={k} className={k === 'title' || k === 'street' ? 'col-span-2' : ''}>
                <label className="field">{k === 'title' ? 'Business name' : k === 'category' ? 'Primary category' : k}</label>
                <input type="text" value={nap[k]} onChange={e => setNap({ ...nap, [k]: e.target.value })} />
              </div>
            ))}
          </div>
        )}
        <div>
          <label className="field">Services offered (one per line)</label>
          <textarea value={services} onChange={e => setServices(e.target.value)} rows={8} placeholder={'Rewiring\nConsumer unit replacement\nEV charger installation'} />
          {l.profileServices.length > 0 && !services && (
            <button className="btn sm mt-2" onClick={() => setServices(l.profileServices.join('\n'))}>Copy the {l.profileServices.length} services from the profile</button>
          )}
        </div>
        <div>
          <label className="field">Areas served (towns, one per line)</label>
          <textarea value={areas} onChange={e => setAreas(e.target.value)} rows={6} placeholder={l.town ? `${l.town}\nHarpenden\nHatfield` : 'St Albans\nHarpenden'} />
          <div className="text-xs muted mt-1">These drive the service × area pages. Real coverage only: Google filters pages for towns you do not serve.</div>
        </div>
        <div>
          <label className="field">Brand voice</label>
          <textarea value={voice} onChange={e => setVoice(e.target.value)} rows={3} placeholder="e.g. Family firm, 20 years in St Albans, plain-spoken, never salesy. Owner is Dan." />
        </div>
      </section>

      <section className="flex flex-col gap-5">
        <div className="panel p-5 flex flex-col gap-3">
          <h2 className="font-semibold">Automation</h2>
          <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={autoReply} onChange={e => setAutoReply(e.target.checked)} /> Auto-reply to new reviews (hourly poll, posts without approval)</label>
          <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={scheduled} onChange={e => setScheduled(e.target.checked)} /> Weekly Google Post</label>
          <div className="grid grid-cols-2 gap-3 pl-7">
            <div><label className="field">Day</label><select value={weekday} onChange={e => setWeekday(Number(e.target.value))}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></div>
            <div><label className="field">Hour (local)</label><input type="number" min={0} max={23} value={hour} onChange={e => setHour(Number(e.target.value))} /></div>
          </div>
          <label className="flex items-center gap-3 text-sm pl-7"><input type="checkbox" checked={autoPost} onChange={e => setAutoPost(e.target.checked)} /> Publish automatically (otherwise it waits as a draft)</label>
          <div className="flex items-center gap-3 text-sm">Release a queued photo every <input type="number" min={1} max={90} value={photoDays} onChange={e => setPhotoDays(Number(e.target.value))} style={{ width: 70 }} /> days</div>
          <div className="text-xs muted">Jobs run while this app is open. A missed slot runs at the next start.</div>
        </div>

        <div className="panel p-5 flex flex-col gap-3">
          <h2 className="font-semibold">Website output</h2>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="field">Folder / slug</label><input type="text" value={slug} onChange={e => setSlug(e.target.value)} /></div>
            <div><label className="field">Brand colour</label><input type="text" value={colour} onChange={e => setColour(e.target.value)} /></div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button className="btn primary" onClick={save}>Save</button>
          <span className="text-sm muted">{msg}</span>
        </div>
      </section>
    </div>
  );
}
