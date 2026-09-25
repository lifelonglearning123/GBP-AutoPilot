import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { exchangeCode, pruneAccountLogins, STATE_COOKIE } from '@/lib/gauth';
import { listAccounts } from '@/lib/gbp';

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
    // Which login manages which Business Profile account is remembered between calls, and the
    // account that just arrived is not in it yet. Learn it now, while the person is still here:
    // otherwise the first scheduled job for one of its businesses asks the wrong account and gets
    // a baffling "Requested entity was not found".
    pruneAccountLogins();
    await listAccounts().catch(() => {});
    const res = back('connected=1');
    res.cookies.delete(STATE_COOKIE);
    return res;
  } catch (e: any) {
    return back('error=' + encodeURIComponent(e.message));
  }
}
