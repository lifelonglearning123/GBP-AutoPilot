'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { callAction } from './Action';
import { checkPhone, normaliseWebsite } from '@/lib/basics-check';
import CategoryPicker, { type Cat, type Cats, type Rivals } from './CategoryPicker';
import FormPart from './FormPart';

const DAYS = [
  ['MONDAY', 'Monday'], ['TUESDAY', 'Tuesday'], ['WEDNESDAY', 'Wednesday'], ['THURSDAY', 'Thursday'],
  ['FRIDAY', 'Friday'], ['SATURDAY', 'Saturday'], ['SUNDAY', 'Sunday'],
] as const;

type Time = { hours?: number; minutes?: number };
type Period = { openDay?: string; openTime?: Time; closeDay?: string; closeTime?: Time };
type Slot = { from: string; to: string };
type Row = { day: string; label: string; slots: Slot[] };
type Status = { kind: 'idle' | 'saving' | 'saved' | 'partial' | 'error'; msg?: string };
type PartKey = 'phone' | 'website' | 'categories' | 'hours';
type Grade = 'good' | 'partial' | 'poor';

const hhmm = (t?: Time) => `${String((t?.hours ?? 0) % 24).padStart(2, '0')}:${String(t?.minutes ?? 0).padStart(2, '0')}`;
const DEFAULT: Slot = { from: '09:00', to: '17:00' };
const PARTS: PartKey[] = ['phone', 'website', 'categories', 'hours'];
/** Anchors used by Next steps, and the part each one lives in. */
const ANCHOR: Record<string, PartKey> = { phone: 'phone', website: 'website', categories: 'categories', 'category-search': 'categories', hours: 'hours' };

/** Every period Google holds, grouped by the day it opens, earliest first. Nothing is dropped. */
function toRows(periods: Period[]): Row[] {
  return DAYS.map(([day, label]) => ({
    day, label,
    slots: periods.filter(p => p.openDay === day)
      .map(p => ({ from: hhmm(p.openTime), to: hhmm(p.closeTime) }))
      .sort((a, b) => a.from.localeCompare(b.from)),
  }));
}

/** "Mon–Fri 08:30–17:00; Sat–Sun closed": consecutive days with the same times are joined. */
function hoursSummary(rows: Row[]): string {
  const text = (r: Row) => (r.slots.length ? r.slots.map(s => `${s.from}–${s.to === '00:00' ? '24:00' : s.to}`).join(', ') : 'closed');
  const groups: { from: string; to: string; text: string }[] = [];
  for (const r of rows) {
    const t = text(r), last = groups[groups.length - 1];
    if (last && last.text === t) last.to = r.label.slice(0, 3);
    else groups.push({ from: r.label.slice(0, 3), to: r.label.slice(0, 3), text: t });
  }
  if (groups.length === 1 && groups[0].text === 'closed') return 'No opening hours set';
  return groups.map(g => `${g.from === g.to ? g.from : `${g.from}–${g.to}`} ${g.text}`).join('; ');
}

/**
 * Phone, website, categories and opening hours, saved straight to the Google profile. Each is a part
 * that sits closed once it is done and has no warnings, so what still needs work stands out. Checks
 * run as each field is left, only changed fields are sent, and the result is said in words.
 */
export default function BasicsForm({ id, linked, name, address, phone, website, periods, categories, catDrafts = [], phoneLocked = false, done, rivals = null, competitorsHref }: {
  id: string; linked: boolean; name: string; address: string;
  phone: string | null; website: string | null; periods: Period[];
  categories: Cats;
  /** Additional categories proposed by a waiting AI draft, offered as one-click adds. */
  catDrafts?: Cat[];
  /** Google has refused phone edits for this profile through the API. */
  phoneLocked?: boolean;
  /** Which parts the audit scores as done, from what Google holds now. */
  done: Record<PartKey, boolean>;
  rivals?: Rivals;
  competitorsHref?: string;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(() => ({ phone: phone ?? '', website: website ?? '', rows: toRows(periods), cats: categories }));
  const [ph, setPh] = useState(saved.phone);
  const [web, setWeb] = useState(saved.website);
  const [rows, setRows] = useState<Row[]>(saved.rows);
  const [cats, setCats] = useState<Cats>(saved.cats);
  const [left, setLeft] = useState({ phone: false, website: false });
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const phoneChanged = !phoneLocked && ph.trim() !== saved.phone.trim();
  const webChanged = web.trim() !== saved.website.trim();
  const hoursChanged = JSON.stringify(rows) !== JSON.stringify(saved.rows);
  const catKey = (c: Cats) => JSON.stringify([c.primary?.name ?? '', c.additional.map(x => x.name)]);
  const catsChanged = catKey(cats) !== catKey(saved.cats);
  const changed = phoneChanged || webChanged || hoursChanged || catsChanged;
  const phoneErr = left.phone && phoneChanged ? checkPhone(ph) : null;
  const webErr = left.website && webChanged ? normaliseWebsite(web).error : null;
  const sameTimes = rows.filter(r => r.slots.some(s => s.from === s.to && s.from !== '00:00')).map(r => r.label);
  // Open past midnight, written either as one period (22:00 to 02:00) or as Google often stores it:
  // closing at 00:00, then a period from 00:00 on the next day.
  const pastMidnight = rows.flatMap((r, i) => {
    const direct = r.slots.find(s => s.to !== '00:00' && s.to < s.from);
    if (direct) return [`${r.label} (until ${direct.to})`];
    const next = rows[(i + 1) % 7];
    const tail = next.slots.find(s => s.from === '00:00' && s.to !== '00:00');
    return tail && r.slots.some(s => s.to === '00:00' && s.from !== '00:00') ? [`${r.label} (until ${tail.to} on ${next.label})`] : [];
  });

  // How each part stands, from what Google holds (done) plus any warning the form can see.
  const edited: Record<PartKey, boolean> = { phone: phoneChanged, website: webChanged, categories: catsChanged, hours: hoursChanged };
  const grade: Record<PartKey, Grade> = {
    phone: done.phone ? 'good' : 'poor',
    website: done.website ? 'good' : 'poor',
    categories: done.categories ? 'good' : saved.cats.primary ? 'partial' : 'poor',
    hours: pastMidnight.length || sameTimes.length ? 'partial' : done.hours ? 'good' : saved.rows.some(r => r.slots.length) ? 'partial' : 'poor',
  };
  const finished = (k: PartKey) => grade[k] === 'good' && !edited[k];
  const [open, setOpen] = useState<Record<PartKey, boolean>>(() =>
    Object.fromEntries(PARTS.map(k => [k, !(grade[k] === 'good')])) as Record<PartKey, boolean>);

  // A part that becomes finished (usually after a save) closes; one that stops being finished opens.
  const was = useRef<Record<PartKey, boolean>>(Object.fromEntries(PARTS.map(k => [k, finished(k)])) as Record<PartKey, boolean>);
  const finishedKey = PARTS.map(k => (finished(k) ? 1 : 0)).join('');
  useEffect(() => {
    const next: Partial<Record<PartKey, boolean>> = {};
    for (const k of PARTS) {
      const now = finished(k);
      if (now && !was.current[k]) next[k] = false;
      if (!now && was.current[k] && grade[k] !== 'good') next[k] = true;
      was.current[k] = now;
    }
    if (Object.keys(next).length) setOpen(o => ({ ...o, ...next }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishedKey]);

  // Next steps link to #phone, #hours and so on: open that part when its anchor is followed.
  useEffect(() => {
    const follow = () => {
      const part = ANCHOR[window.location.hash.slice(1)];
      if (!part) return;
      setOpen(o => ({ ...o, [part]: true }));
      requestAnimationFrame(() => document.getElementById(`part-${part}`)?.scrollIntoView({ block: 'start' }));
    };
    follow();
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);

  const toggle = (k: PartKey) => setOpen(o => ({ ...o, [k]: !o[k] }));
  const touch = () => { if (status.kind !== 'saving') setStatus({ kind: 'idle' }); };
  const setSlots = (i: number, f: (s: Slot[]) => Slot[]) => { setRows(rs => rs.map((r, j) => (j === i ? { ...r, slots: f(r.slots) } : r))); touch(); };
  const copyMonday = () => { setRows(rs => rs.map((r, j) => (j >= 1 && j <= 4 ? { ...r, slots: rs[0].slots.map(s => ({ ...s })) } : r))); touch(); };
  const undo = () => { setPh(saved.phone); setWeb(saved.website); setRows(saved.rows); setCats(saved.cats); setLeft({ phone: false, website: false }); setStatus({ kind: 'idle' }); };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLeft({ phone: true, website: true });
    const pe = phoneChanged ? checkPhone(ph) : null;
    const we = webChanged ? normaliseWebsite(web).error : null;
    if (pe || we || sameTimes.length || (catsChanged && !cats.primary)) {
      // Open the part that needs fixing, so the message points at something visible.
      setOpen(o => ({ ...o, ...(pe ? { phone: true } : {}), ...(we ? { website: true } : {}), ...(sameTimes.length ? { hours: true } : {}), ...(catsChanged && !cats.primary ? { categories: true } : {}) }));
      setStatus({ kind: 'error', msg: sameTimes.length ? `Opening and closing times are the same on ${sameTimes.join(', ')}.`
        : catsChanged && !cats.primary ? 'Choose a primary category before saving.' : 'Fix the highlighted field first.' });
      return;
    }
    const basics: Record<string, unknown> = {};
    const site = normaliseWebsite(web).value;
    if (phoneChanged) basics.phone = ph.trim();
    if (webChanged) basics.website = site;
    if (hoursChanged) basics.hours = rows.flatMap(r => r.slots.map(s => ({ day: r.day, open: s.from, close: s.to })));
    if (catsChanged && cats.primary) basics.categories = { primary: cats.primary.name, additional: cats.additional.map(c => c.name) };
    setStatus({ kind: 'saving' });
    try {
      const r = await callAction<{ saved: string[]; notSaved: { field: string; reason: string }[] }>('location.basics', { id, basics });
      const ok = (f: string) => r.saved.includes(f);
      const next = {
        phone: ok('phone number') ? ph.trim() : saved.phone,
        website: ok('website') ? site : saved.website,
        rows: ok('opening hours') ? rows : saved.rows,
        cats: ok('categories') ? cats : saved.cats,
      };
      setSaved(next);
      if (ok('website')) setWeb(site);
      const msg = `Saved the ${r.saved.join(' and ')} to Google. It can take a few minutes to show on Google, and Google checks some changes first.`;
      setStatus(r.notSaved.length
        ? { kind: 'partial', msg: `${msg} Not saved: ${r.notSaved.map(n => `${n.field}. ${n.reason}`).join(' ')}` }
        : { kind: 'saved', msg });
      router.refresh();
    } catch (err: any) {
      setStatus({ kind: 'error', msg: err?.message ?? String(err) });
    }
  }

  const help = (err: string | null, text: string) => (
    <p className="text-xs mt-1.5" style={{ color: err ? 'var(--bad)' : 'var(--muted)' }}>{err ?? text}</p>
  );
  const anyClosed = PARTS.some(k => !open[k]);
  const summaries: Record<PartKey, string> = {
    phone: saved.phone || (phoneLocked ? 'Missing. Add it in Google Business Profile' : 'Missing'),
    website: saved.website || 'Missing',
    categories: saved.cats.primary
      ? `${saved.cats.primary.displayName}${saved.cats.additional.length ? `, plus ${saved.cats.additional.map(c => c.displayName).join(', ')}` : ', no additional categories'}`
      : 'No primary category',
    hours: hoursSummary(saved.rows),
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-5" noValidate>
      {!linked && (
        <p className="text-sm rounded-lg px-3 py-2" style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}>
          This business was added by hand, so there is no Google profile to save to. Ask the owner to add your Google account as a manager, then sync.
        </p>
      )}

      <div className="flex flex-col gap-2">
        <dl className="grid gap-4 sm:grid-cols-2 text-sm">
          <div>
            <dt className="font-medium">Business name</dt>
            <dd className="mt-0.5">{name}</dd>
          </div>
          <div>
            <dt className="font-medium">Address</dt>
            <dd className="mt-0.5">{address || 'No address shown. Customers see a service area instead.'}</dd>
          </div>
        </dl>
        <p className="text-xs muted">
          Change the name or address in Google Business Profile itself. Google may ask you to verify the business again after either change.
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3 pb-1">
          <p className="text-xs muted">Finished parts are closed. Open one to change it.</p>
          {anyClosed && (
            <button type="button" className="text-xs font-semibold" style={{ color: 'var(--accent-text)' }}
              onClick={() => setOpen({ phone: true, website: true, categories: true, hours: true })}>Open all</button>
          )}
        </div>

        <FormPart id="phone" title="Phone number" summary={summaries.phone} grade={grade.phone} open={open.phone} onToggle={() => toggle('phone')} edited={edited.phone}>
          <div className="max-w-md">
            <label className="sr-only" htmlFor="phone">Phone number</label>
            <input id="phone" type="tel" autoComplete="tel" inputMode="tel" placeholder={phoneLocked ? '' : '01223 123456'}
              value={phoneLocked ? saved.phone : ph} disabled={!linked || phoneLocked} aria-invalid={Boolean(phoneErr)} aria-describedby="phone-help"
              onChange={e => { setPh(e.target.value); touch(); }} onBlur={() => setLeft(l => ({ ...l, phone: true }))} />
            <div id="phone-help">
              {phoneLocked ? (
                <p className="text-xs mt-1.5" style={{ color: 'var(--warn)' }}>
                  Google does not let this profile’s phone number be changed from outside Google. Add it in{' '}
                  <a className="underline" href="https://business.google.com/" target="_blank" rel="noopener">Google Business Profile</a>: Edit profile, then Contact.
                </p>
              ) : help(phoneErr, 'The number customers call. Use the same one as on the website.')}
            </div>
          </div>
        </FormPart>

        <FormPart id="website" title="Website" summary={summaries.website} grade={grade.website} open={open.website} onToggle={() => toggle('website')} edited={edited.website}>
          <div className="max-w-md">
            <label className="sr-only" htmlFor="website">Website</label>
            <input id="website" type="url" autoComplete="url" inputMode="url" placeholder="https://example.co.uk"
              value={web} disabled={!linked} aria-invalid={Boolean(webErr)} aria-describedby="website-help"
              onChange={e => { setWeb(e.target.value); touch(); }}
              onBlur={() => { setLeft(l => ({ ...l, website: true })); const n = normaliseWebsite(web); if (!n.error && n.value !== web.trim()) setWeb(n.value); }} />
            <div id="website-help">{help(webErr, 'The business’s own site, not a directory page.')}</div>
          </div>
        </FormPart>

        <FormPart id="categories" title="Categories" summary={summaries.categories} grade={grade.categories} open={open.categories} onToggle={() => toggle('categories')} edited={edited.categories}>
          <CategoryPicker id={id} value={cats} onChange={c => { setCats(c); touch(); }} drafts={catDrafts} disabled={!linked} hideLegend
            rivals={rivals} competitorsHref={competitorsHref} />
        </FormPart>

        <FormPart id="hours" title="Opening hours" summary={summaries.hours} grade={grade.hours} open={open.hours} onToggle={() => toggle('hours')} edited={edited.hours}>
          <fieldset id="hours" disabled={!linked}>
            <legend className="sr-only">Opening hours</legend>
            <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
              <p className="text-xs muted">Tick the days you open. Add a second time for a lunch break. A closing time of 00:00 means midnight.</p>
              <button type="button" className="btn sm" onClick={copyMonday}>Copy Monday to Tuesday–Friday</button>
            </div>
            {pastMidnight.length > 0 && (
              <p className="text-xs mb-2" style={{ color: 'var(--warn)' }}>
                Open after midnight: {pastMidnight.join(', ')}. Check that is right, and remove the extra time if it is not.
              </p>
            )}
            <div className="border-y divide-y" style={{ borderColor: 'var(--line)' }}>
              {rows.map((r, i) => {
                const isOpen = r.slots.length > 0;
                return (
                  <div key={r.day} className="grid items-start gap-x-3 py-2.5" style={{ gridTemplateColumns: '6.5rem 6.5rem minmax(0, 1fr)', borderColor: 'var(--line-soft)' }}>
                    <span className="text-sm font-medium pt-2">{r.label}</span>
                    <label className="flex items-center gap-2 text-sm cursor-pointer pt-2">
                      <input type="checkbox" checked={isOpen} className="w-4 h-4 accent-[var(--accent)]"
                        onChange={e => setSlots(i, () => (e.target.checked ? [{ ...DEFAULT }] : []))} />
                      <span className={isOpen ? '' : 'muted'}>{isOpen ? 'Open' : 'Closed'}</span>
                    </label>
                    <div className="flex flex-col gap-2 min-w-0">
                      {r.slots.map((s, k) => (
                        <div key={k} className="flex items-center gap-2 flex-wrap">
                          <input type="time" style={{ width: '8rem' }} aria-label={`${r.label} opens at`} value={s.from}
                            onChange={e => setSlots(i, ss => ss.map((x, m) => (m === k ? { ...x, from: e.target.value } : x)))} />
                          <span className="text-sm muted">to</span>
                          <input type="time" style={{ width: '8rem' }} aria-label={`${r.label} closes at`} value={s.to}
                            onChange={e => setSlots(i, ss => ss.map((x, m) => (m === k ? { ...x, to: e.target.value } : x)))} />
                          {r.slots.length > 1 && (
                            <button type="button" className="btn sm" aria-label={`Remove ${r.label} ${s.from} to ${s.to}`}
                              onClick={() => setSlots(i, ss => ss.filter((_, m) => m !== k))}>Remove</button>
                          )}
                        </div>
                      ))}
                      {isOpen && (
                        <button type="button" className="text-xs font-semibold self-start" style={{ color: 'var(--accent-text)' }}
                          onClick={() => setSlots(i, ss => [...ss, { from: '13:00', to: '17:00' }])}>Add another time</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </fieldset>
        </FormPart>
        <div className="border-t" style={{ borderColor: 'var(--line)' }} />
      </div>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p role="status" aria-live="polite" className="text-sm max-w-md"
          style={{ color: status.kind === 'error' ? 'var(--bad)' : status.kind === 'partial' ? 'var(--warn)' : status.kind === 'saved' ? 'var(--good)' : 'var(--muted)' }}>
          {status.kind === 'saving' ? 'Saving to Google…'
            : status.msg ?? (changed ? 'You have changes that are not saved yet.' : 'Saving sends the changes straight to the Google profile.')}
        </p>
        <div className="flex gap-2">
          {changed && status.kind !== 'saving' && <button type="button" className="btn" onClick={undo}>Undo changes</button>}
          <button type="submit" className="btn primary" disabled={!linked || !changed || status.kind === 'saving'}>
            {status.kind === 'saving' ? 'Saving…' : 'Save to Google'}
          </button>
        </div>
      </div>
    </form>
  );
}
