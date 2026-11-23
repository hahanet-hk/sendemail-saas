import { NextResponse } from 'next/server';

const MARKETING_PATHS = new Set(['/', '/pricing', '/features', '/security', '/docs']);

export function middleware(request) {
  const { pathname } = request.nextUrl;
  const rawHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const host = rawHost.split(':')[0].toLowerCase();

  // 放行靜態資源、API、SEO 端點與內部 marketing 路徑
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/t/') ||
    pathname.startsWith('/dns-share') ||
    pathname === '/sitemap.xml' ||
    pathname === '/robots.txt'
  ) {
    return NextResponse.next();
  }

  // 1. www.sendemail.ai 或 sendemail.ai 導向公開商業官網路由
  if (host === 'www.sendemail.ai' || host === 'sendemail.ai') {
    if (pathname === '/login' || pathname === '/register') {
      const appUrl = new URL(pathname, 'https://app.sendemail.ai');
      return NextResponse.redirect(appUrl);
    }
    if (MARKETING_PATHS.has(pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = pathname === '/' ? '/marketing' : `/marketing${pathname}`;
      return NextResponse.rewrite(url);
    }
  }

  // 2. app.sendemail.ai 導向開發者控制台（若訪問 /marketing 則導回 /）
  if (host === 'app.sendemail.ai' && pathname.startsWith('/marketing')) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
