import { location, isLinked } from '@/lib/locations';
import { qna } from '@/lib/extras';
import { locId } from '@/lib/ids';
import Action from '@/components/Action';
import QnaCard from '@/components/QnaCard';

export const dynamic = 'force-dynamic';

export default async function QnaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = location(locId(id))!;
  const rows = qna(l.id);
  const drafts = rows.filter(r => r.status === 'draft');
  const rest = rows.filter(r => r.status !== 'draft' && r.status !== 'rejected');
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm muted max-w-2xl">
          The Q&A section on the profile is public and indexed. Left empty it fills with strangers' questions. Seed it with the questions
          customers actually ask, answered by the owner, and each pair posts as a question plus an owner answer.
        </p>
        <Action action="qna.generate" params={{ id: l.id, count: 6 }} className="btn primary" busy="Writing…">Draft 6 questions</Action>
      </div>
      {drafts.length > 0 && <section className="flex flex-col gap-3"><h2 className="font-semibold">Drafts</h2>{drafts.map(q => <QnaCard key={q.id} q={q} linked={isLinked(l)} />)}</section>}
      {rest.length > 0 && <section className="flex flex-col gap-3"><h2 className="font-semibold muted">Posted</h2>{rest.map(q => <QnaCard key={q.id} q={q} linked={isLinked(l)} />)}</section>}
      {rows.length === 0 && <div className="panel p-8 text-center muted">Nothing drafted yet.</div>}
    </div>
  );
}
