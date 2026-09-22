import { preview, STYLES } from '@/lib/site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; slug: string[] }> }) {
  const { id, slug } = await params;
  const path = slug.join('/');
  if (path === 'styles.css') return new Response(STYLES, { headers: { 'Content-Type': 'text/css' } });
  try {
    return new Response(preview(decodeURIComponent(id), path), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch (e: any) {
    return new Response(e.message, { status: 404 });
  }
}
