import Link from 'next/link';
import { locParam } from '@/lib/ids';
import { byKind, byLocation, costOf, monthLabel, monthTotal, months, rates, thisMonth } from '@/lib/usage';
import RateForm from '@/components/RateForm';

export const dynamic = 'force-dynamic';

const money = (n: number) => (n < 0.01 && n > 0 ? 'under $0.01' : `$${n.toFixed(2)}`);
const num = (n: number) => Math.round(n).toLocaleString('en-GB');

/**
 * What each client costs to run. Google is free, so this is Serper searches and AI calls, priced at
 * what the suppliers charge. It answers one question before a price list is set: is any client an
 * outlier?
 */
export default async function UsagePage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const known = months();
  const month = m && known.includes(m) ? m : known[0] ?? thisMonth();
  const rows = byLocation(month);
  const total = monthTotal(month);
  const r = rates();
  const cost = costOf(total, r);
  const clients = rows.filter(x => x.location_id);
  const perClient = clients.length ? cost / clients.length : 0;

  return (
    <div className="flex flex-col gap-8 max-w-[1000px]">
      <header className="flex items-end justify-between gap-x-6 gap-y-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold">What it costs to run</h1>
          <p className="muted mt-1.5 max-w-prose">
            Google charges nothing for reviews, posts, profile changes and stats. The only spend is map and search
            lookups, and the AI that writes. This is {monthLabel(month)}.
          </p>
        </div>
        {known.length > 1 && (
          <nav aria-label="Month" className="flex items-center gap-1 text-sm flex-wrap">
            {known.slice(0, 6).map(k => (
              <Link key={k} href={k === known[0] ? '/usage' : `/usage?m=${k}`} className={`tab ${k === month ? 'active' : ''}`} aria-current={k === month ? 'true' : undefined}>
                {monthLabel(k)}
              </Link>
            ))}
          </nav>
        )}
      </header>

      {rows.length === 0 ? (
        <div className="panel p-10 text-center">
          <h2 className="text-lg font-semibold">Nothing recorded yet this month</h2>
          <p className="muted mt-2 max-w-prose mx-auto">
            Searches and AI calls are counted from now on. Run a check or let the scheduler work, and the cost per
            business appears here.
          </p>
        </div>
      ) : (
        <>
          <section className="panel-2 p-6 flex flex-wrap gap-x-12 gap-y-4">
            <div>
              <div className="text-sm muted">Everything this month</div>
              <div className="display text-3xl font-semibold score">{money(cost)}</div>
            </div>
            <div>
              <div className="text-sm muted">Average per business</div>
              <div className="display text-3xl font-semibold score">{money(perClient)}</div>
            </div>
            <div>
              <div className="text-sm muted">Searches and AI calls</div>
              <div className="display text-3xl font-semibold score">{num(total.searches)} <span className="text-base muted">and</span> {num(total.ai_calls)}</div>
            </div>
          </section>

          <section aria-labelledby="per-h" className="flex flex-col gap-3">
            <h2 id="per-h" className="text-lg font-semibold">By business</h2>
            <div className="panel overflow-hidden">
              <div className="hidden md:grid px-5 py-2.5 text-xs muted" style={{ background: 'var(--panel-2)', gridTemplateColumns: 'minmax(0,2fr) 7rem 7rem 8rem 6rem' }}>
                <span>Business</span><span>Searches</span><span>AI calls</span><span>Words written</span><span>Cost</span>
              </div>
              {rows.map(row => {
                const c = costOf(row, r);
                const parts = byKind(month, row.location_id);
                return (
                  <div key={row.location_id ?? 'agency'} className="px-5 py-4 border-t flex flex-col gap-1 md:grid md:gap-0" style={{ gridTemplateColumns: 'minmax(0,2fr) 7rem 7rem 8rem 6rem' }}>
                    <div className="min-w-0">
                      {row.location_id ? (
                        <Link href={`/locations/${locParam(row.location_id)}`} className="font-medium">{row.title ?? row.location_id}</Link>
                      ) : (
                        <span className="font-medium">Prospecting and other agency work</span>
                      )}
                      <div className="text-xs muted mt-0.5">{parts.map(p => `${p.kind} ${p.calls}`).join(', ') || 'nothing yet'}</div>
                    </div>
                    <div className="text-sm score"><span className="md:hidden muted">Searches: </span>{num(row.searches)}</div>
                    <div className="text-sm score"><span className="md:hidden muted">AI calls: </span>{num(row.ai_calls)}</div>
                    <div className="text-sm score"><span className="md:hidden muted">Words: </span>{num(row.tokens * 0.75)}</div>
                    <div className="text-sm score font-medium"><span className="md:hidden muted">Cost: </span>{money(c)}</div>
                  </div>
                );
              })}
            </div>
            <p className="text-xs muted">
              A business on a $49 a month plan leaves whatever is left of that after its line above. Google API calls are free and are not counted.
            </p>
          </section>
        </>
      )}

      <RateForm serperPer1k={r.serperPer1k} aiPer1m={r.aiPer1m} />
    </div>
  );
}
