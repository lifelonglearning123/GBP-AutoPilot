import { Fragment, type ReactNode } from 'react';
import { FAQ, type Block } from '@/lib/faq';

export const metadata = { title: 'Help · GBP Autopilot' };

/** `code` and **bold** inside FAQ strings. */
function inline(s: string): ReactNode[] {
  return s.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) => {
    if (part.startsWith('`')) return <code key={i} className="px-1.5 py-0.5 rounded text-[0.85em]" style={{ background: 'var(--panel-2)', border: '1px solid var(--line-soft)' }}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**')) return <strong key={i} className="text-[var(--text)]">{part.slice(2, -2)}</strong>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function BlockView({ b }: { b: Block }) {
  if (typeof b === 'string') return <p className="leading-relaxed">{inline(b)}</p>;
  if ('steps' in b) return <ol className="list-decimal pl-6 flex flex-col gap-1.5">{b.steps.map((s, i) => <li key={i} className="leading-relaxed">{inline(s)}</li>)}</ol>;
  if ('list' in b) return <ul className="list-disc pl-6 flex flex-col gap-1.5">{b.list.map((s, i) => <li key={i} className="leading-relaxed">{inline(s)}</li>)}</ul>;
  if ('code' in b) return <pre className="panel-2 px-3 py-2 text-xs overflow-x-auto whitespace-pre-wrap break-all"><code>{b.code}</code></pre>;
  if ('tip' in b) return <div className="panel-2 px-3 py-2 text-sm" style={{ borderLeft: '3px solid var(--info)' }}>{inline(b.tip)}</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs muted uppercase text-left"><tr>{b.table.head.map(h => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody>{b.table.rows.map((r, i) => <tr key={i} className="border-t" style={{ borderColor: 'var(--line-soft)' }}>{r.map((c, j) => <td key={j} className="px-3 py-2 align-top">{inline(c)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export default function HelpPage() {
  return (
    <div className="flex flex-col gap-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Help</h1>
        <p className="muted text-sm mt-1">Common questions about adding businesses, reading the audit, and setup.</p>
      </div>

      <nav className="panel p-5 grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {FAQ.map(sec => (
          <div key={sec.title}>
            <div className="text-xs muted uppercase tracking-wide mb-2">{sec.title}</div>
            <ul className="flex flex-col gap-1.5 text-sm">
              {sec.items.map(it => <li key={it.id}><a href={`#${it.id}`} className="hover:underline">{it.q}</a></li>)}
            </ul>
          </div>
        ))}
      </nav>

      {FAQ.map(sec => (
        <section key={sec.title} className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">{sec.title}</h2>
          {sec.items.map(it => (
            <article key={it.id} id={it.id} className="faq-item panel p-5 flex flex-col gap-3 text-sm muted scroll-mt-6">
              <h3 className="text-base font-semibold text-[var(--text)]">
                <a href={`#${it.id}`} className="hover:underline">{it.q}</a>
              </h3>
              {it.a.map((b, i) => <BlockView key={i} b={b} />)}
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
