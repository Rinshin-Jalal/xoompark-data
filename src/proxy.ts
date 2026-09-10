import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith('/dashboard')) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get('session')?.value;

  if (!sessionCookie) {
    const authUrl = new URL('/auth', request.url);
    authUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(authUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
