import { NextResponse } from 'next/server';
import { disconnect } from '@/lib/gauth';

/** Disconnect one Google account (?login=), or every one of them when no login is given. */
export async function GET(req: Request) {
  const login = new URL(req.url).searchParams.get('login') ?? undefined;
  disconnect(login);
  return NextResponse.redirect(new URL('/settings', req.url));
}
