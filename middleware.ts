import { getToken } from 'next-auth/jwt';
import { NextRequest, NextResponse } from 'next/server';
import { contentSecurityPolicy } from '@/lib/security/csp';

export default async function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const policy = contentSecurityPolicy(nonce, process.env.NODE_ENV !== 'production');
  const headers = new Headers(request.headers);
  // Next reads the request CSP to attach the nonce to framework scripts, even during report-only rollout.
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', policy);
  const pathname = request.nextUrl.pathname;
  let response: NextResponse;
  if (/^\/(dashboard|settings)(\/|$)/.test(pathname) && !await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })) {
    const login = new URL('/login', request.url);
    login.searchParams.set('callbackUrl', request.nextUrl.pathname + request.nextUrl.search);
    response = NextResponse.redirect(login);
  } else {
    response = NextResponse.next({ request: { headers } });
  }
  response.headers.set(process.env.CSP_ENFORCE === 'true' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only', policy);
  // A nonce must never be reused via a shared HTML cache.
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = {
  matcher: ['/((?!api/|_next/static|_next/image|favicon|og-image).*)'],
};
