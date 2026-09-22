import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { authUrl, hasOAuthConfig, STATE_COOKIE } from '@/lib/gauth';

export async function GET(req: Request) {
  if (!hasOAuthConfig()) return NextResponse.redirect(new URL('/settings?error=' + encodeURIComponent('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set'), req.url));
  const state = randomBytes(16).toString('hex');
  const res = NextResponse.redirect(authUrl(state));
  res.cookies.set(STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', maxAge: 600, path: '/' });
  return res;
}
