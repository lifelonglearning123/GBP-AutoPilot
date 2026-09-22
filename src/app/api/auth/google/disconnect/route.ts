import { NextResponse } from 'next/server';
import { disconnect } from '@/lib/gauth';

export async function GET(req: Request) {
  disconnect();
  return NextResponse.redirect(new URL('/settings', req.url));
}
