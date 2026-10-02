import { location, isLinked } from '@/lib/locations';
import { notFound } from 'next/navigation';
import { posts } from '@/lib/posts';
import { locId } from '@/lib/ids';
import Action from '@/components/Action';
import PostCard from '@/components/PostCard';
import PhotoUpload from '@/components/PhotoUpload';
import PhotoQueue from '@/components/PhotoQueue';
import { photos } from '@/lib/extras';

export const dynamic = 'force-dynamic';

export default async function PostsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = location(locId(id));
  if (!l) notFound();
  const ps = posts(l.id);
  const drafts = ps.filter(p => p.status === 'draft');
  const rest = ps.filter(p => p.status !== 'draft');
  const next = l.next_post_at ? new Date(l.next_post_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm muted">
          {next ? <>Next weekly post: <span className="text-[var(--text)]">{next}</span> · {l.auto_post ? 'publishes automatically' : 'drafts for approval'}</> : 'Weekly post schedule is off (turn it on under Configure).'}
        </div>
        <Action action="posts.generate" params={{ id: l.id }} className="btn primary" busy="Writing…">Draft a post now</Action>
      </div>

      {drafts.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">Drafts</h2>
          {drafts.map(p => <PostCard key={p.id} p={p} linked={isLinked(l)} />)}
        </section>
      )}

      {isLinked(l) && <PhotoQueue locationId={l.id} items={photos(l.id)} everyDays={l.photo_every_days} nextAt={l.next_photo_at} />}
      {isLinked(l) && <PhotoUpload locationId={l.id} />}

      {rest.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold muted">History</h2>
          {rest.map(p => <PostCard key={p.id} p={p} />)}
        </section>
      )}
      {ps.length === 0 && <div className="panel p-8 text-center muted">No posts yet. Draft one now, or turn on the weekly schedule.</div>}
    </div>
  );
}
