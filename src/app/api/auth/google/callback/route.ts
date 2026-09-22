import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { exchangeCode, STATE_COOKIE } from '@/lib/gauth';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const err = url.searchParams.get('error');
  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  const back = (q: string) => NextResponse.redirect(new URL(`/settings?${q}`, req.url));

  if (err) return back('error=' + encodeURIComponent(`Google: ${err}`));
  if (!code || !state || state !== expected) return back('error=' + encodeURIComponent('OAuth state mismatch. Start again from Settings.'));
  try {
    await exchangeCode(code);
    const res = back('connected=1');
    res.cookies.delete(STATE_COOKIE);
    return res;
  } catch (e: any) {
    return back('error=' + encodeURIComponent(e.message));
  }
}
