import fs from 'node:fs';
import { location } from '@/lib/locations';
import { locId } from '@/lib/ids';
import * as report from '@/lib/report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** The prospect report as a page. `?rebuild=1` regenerates; otherwise the last built file is served. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = location(locId(id));
  if (!l) return new Response('Not found', { status: 404 });
  const rebuild = new URL(req.url).searchParams.get('rebuild') === '1';
  try {
    const html = !rebuild && l.report_url && /\.html$/i.test(l.report_url) && fs.existsSync(l.report_url)
      ? fs.readFileSync(l.report_url, 'utf8')
      : (await report.build(l.id)).html;
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch (e: any) {
    return new Response(e.message, { status: 500 });
  }
}
