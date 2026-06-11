import { NextRequest, NextResponse } from 'next/server';

// Protect the /dashboard area with HTTP Basic Auth (single owner/admin user).
// Credentials come from DASHBOARD_USER / DASHBOARD_PASSWORD env vars.
export const config = { matcher: ['/dashboard', '/dashboard/:path*'] };

export function middleware(req: NextRequest) {
  const user = process.env.DASHBOARD_USER || 'admin';
  const pass = process.env.DASHBOARD_PASSWORD;

  // If no password is configured, lock the dashboard rather than leaving it open.
  if (!pass) {
    return new NextResponse('Dashboard sin configurar (falta DASHBOARD_PASSWORD).', { status: 503 });
  }

  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Basic ')) {
    const decoded = atob(auth.slice(6));
    const idx = decoded.indexOf(':');
    const u = decoded.slice(0, idx);
    const p = decoded.slice(idx + 1);
    if (u === user && p === pass) return NextResponse.next();
  }

  return new NextResponse('Autenticación requerida', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Finca Dashboard"' },
  });
}
