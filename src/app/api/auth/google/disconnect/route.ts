import { NextResponse } from 'next/server';
import { disconnect } from '@/lib/gauth';

/**
 * Disconnect one Google account (?login=), or every one of them when no login is given.
 *
 * It is a link, so it is a GET, and a GET that changes something can be set off by any web page
 * that points an image or a redirect at it. The browser says where a request came from: only one
 * from this app's own pages, or typed into the address bar, is carried out.
 */
export async function GET(req: Request) {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') {
    return NextResponse.json({ error: 'This request came from another website.' }, { status: 403 });
  }
  const login = new URL(req.url).searchParams.get('login') ?? undefined;
  disconnect(login);
  return NextResponse.redirect(new URL('/settings', req.url));
}
