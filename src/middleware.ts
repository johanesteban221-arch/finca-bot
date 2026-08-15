import { NextRequest, NextResponse } from 'next/server';
import { LEGACY_HEADER, LOGIN_PATH } from './lib/auth/constants';

// Guardia de /dashboard. Tres caminos, en este orden:
//
//   1. Hay cookie de sesión de Supabase  -> pasa. La verificación DE VERDAD la
//      hace cada página con getSesion(); aquí solo se evita el viaje al login.
//      El middleware no valida el token a propósito: en el App Router el layout
//      y la página se renderizan en paralelo, así que el guardia tiene que estar
//      en la página de todos modos, y duplicarlo aquí solo agrega una llamada
//      de red en el Edge que no decide nada.
//   2. AUTH_LEGACY_BASIC=1 -> Basic Auth de arranque (el de siempre). Es lo que
//      permite crear el primer usuario real sin quedar afuera del sistema.
//      Ver db/04_auth_roles.sql §4.
//   3. Ni lo uno ni lo otro -> al login.
//
// Fail-closed se conserva: con el Basic encendido y sin DASHBOARD_PASSWORD
// responde 503, nunca abre.
export const config = { matcher: ['/dashboard', '/dashboard/:path*'] };

const tieneCookieAuth = (req: NextRequest) =>
  req.cookies.getAll().some((c) => c.name.startsWith('sb-') && c.name.includes('auth-token'));

function basicValido(req: NextRequest, user: string, pass: string): boolean {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Basic ')) return false;
  const decoded = atob(auth.slice(6));
  const idx = decoded.indexOf(':');
  return decoded.slice(0, idx) === user && decoded.slice(idx + 1) === pass;
}

export function middleware(req: NextRequest) {
  // Se borra siempre, antes de decidir nada: si esta cabecera pudiera llegar
  // desde el cliente, cualquiera entraría como dueño.
  const headers = new Headers(req.headers);
  headers.delete(LEGACY_HEADER);

  if (tieneCookieAuth(req)) return NextResponse.next({ request: { headers } });

  if (process.env.AUTH_LEGACY_BASIC === '1') {
    const user = process.env.DASHBOARD_USER || 'admin';
    const pass = process.env.DASHBOARD_PASSWORD;
    if (!pass) {
      return new NextResponse('Dashboard sin configurar (falta DASHBOARD_PASSWORD).', { status: 503 });
    }
    if (basicValido(req, user, pass)) {
      headers.set(LEGACY_HEADER, '1');
      return NextResponse.next({ request: { headers } });
    }
    return new NextResponse('Autenticación requerida', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Finca Dashboard"' },
    });
  }

  const url = req.nextUrl.clone();
  url.pathname = LOGIN_PATH;
  url.search = `?desde=${encodeURIComponent(req.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}
