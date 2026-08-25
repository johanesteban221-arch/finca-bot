// Shell del tablero: barra lateral fija en escritorio, navegación horizontal
// desplazable en móvil. Sin estado ni JS de cliente — la navegación son anclas
// a las secciones del tablero, así que todo sigue siendo server component.
//
// Las anclas van con ruta absoluta (`/dashboard#...`) y no sueltas: este layout
// también envuelve la hoja de vida del animal y la gestión de usuarios, donde un
// `#inventario` a secas no llevaría a ninguna parte.
//
// ⚠️ Lo que se muestra aquí NO es la autorización. Esconder el enlace de
// Usuarios es cortesía; el guardia real está en cada página y en cada server
// action. En el App Router el layout y la página se renderizan en paralelo, así
// que un guardia puesto aquí no llegaría a tiempo de frenar nada.

import type { ReactNode } from 'react';
import {
  LayoutDashboard, Baby, Scale, Stethoscope, Skull, Milk, TriangleAlert, Users,
} from 'lucide-react';
import { getSesion } from '@/lib/auth/server';
import { puede, ROL_LABEL, type Permiso } from '@/lib/auth/roles';
import { cerrarSesion } from '@/app/login/actions';

const SECCIONES = [
  { href: '/dashboard#inventario', label: 'Inventario', Icon: LayoutDashboard },
  { href: '/dashboard#reproductivo', label: 'Reproductivo', Icon: Baby },
  { href: '/dashboard#peso', label: 'Peso y ganancia', Icon: Scale },
  { href: '/dashboard#sanidad', label: 'Sanidad', Icon: Stethoscope },
  { href: '/dashboard#mortalidad', label: 'Mortalidad', Icon: Skull },
  { href: '/dashboard#leche', label: 'Leche', Icon: Milk },
  { href: '/dashboard#alertas', label: 'Alertas', Icon: TriangleAlert },
];

// Formularios de captura (Bloque D). Cada uno lleva el permiso que su acción
// exige, así que el vaquero ve Control lechero y no Chequeo, y el veterinario al
// revés — que es justo como los reparte la matriz de auth/roles.ts.
//
// ⚠️ Esto sigue siendo cortesía, no autorización: esconder el enlace no impide
// un POST a mano. El guardia de verdad está en cada página y en cada acción.
const FORMULARIOS: { href: string; label: string; Icon: typeof Users; permiso: Permiso }[] = [
  { href: '/dashboard/leche', label: 'Control lechero', Icon: Milk, permiso: 'leche.registrar' },
];

const USUARIOS = { href: '/dashboard/usuarios', label: 'Usuarios', Icon: Users };

function Marca() {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-lg bg-campo-600 text-lg shadow-sm"
      >
        🐄
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold leading-tight text-white">Finca</span>
        <span className="block truncate text-xs leading-tight text-campo-200">Gestión ganadera</span>
      </span>
    </div>
  );
}

const Salir = ({ className = '' }: { className?: string }) => (
  <form action={cerrarSesion}>
    <button
      type="submit"
      className={`rounded-lg px-2.5 py-1 text-xs font-medium text-campo-100 hover:bg-campo-800 hover:text-white ${className}`}
    >
      Salir
    </button>
  </form>
);

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const sesion = await getSesion();
  const usuario = sesion.estado === 'ok' ? sesion.usuario : null;
  const formularios = usuario
    ? FORMULARIOS.filter((f) => puede(usuario.rol, f.permiso))
    : [];
  const enlaces = [
    ...SECCIONES,
    ...formularios,
    ...(usuario && puede(usuario.rol, 'usuario.administrar') ? [USUARIOS] : []),
  ];

  return (
    <div className="min-h-screen lg:flex">
      {/* Barra lateral — escritorio */}
      <aside className="sticky top-0 z-20 hidden h-screen w-64 shrink-0 flex-col border-r border-campo-950/40 bg-campo-900 p-4 lg:flex">
        <Marca />
        <nav className="mt-6 flex-1 space-y-0.5">
          {enlaces.map(({ href, label, Icon }) => (
            <a
              key={href}
              href={href}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-campo-100 transition-colors hover:bg-campo-800 hover:text-white"
            >
              <Icon className="size-4 shrink-0 text-campo-300" aria-hidden />
              {label}
            </a>
          ))}
        </nav>

        {usuario ? (
          <div className="mt-4 border-t border-campo-800 pt-3">
            <p className="truncate text-sm font-medium text-white">{usuario.nombre}</p>
            <p className="truncate text-xs text-campo-300">
              {ROL_LABEL[usuario.rol]}
              {usuario.legado && ' · acceso de arranque'}
            </p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xs text-campo-300/70">Registros por WhatsApp</span>
              <Salir />
            </div>
          </div>
        ) : (
          <p className="mt-4 border-t border-campo-800 pt-3 text-xs leading-relaxed text-campo-300/80">
            Toque cualquier arete para abrir la hoja de vida del animal.
            <br />
            Los registros entran por WhatsApp.
          </p>
        )}
      </aside>

      {/* Encabezado + navegación — móvil */}
      <div className="sticky top-0 z-20 bg-campo-900 lg:hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <Marca />
          {usuario && (
            <div className="flex items-center gap-2">
              <span className="truncate text-xs text-campo-200">{ROL_LABEL[usuario.rol]}</span>
              <Salir className="border border-campo-700" />
            </div>
          )}
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
          {enlaces.map(({ href, label, Icon }) => (
            <a
              key={href}
              href={href}
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-campo-100 hover:bg-campo-800"
            >
              <Icon className="size-3.5 text-campo-300" aria-hidden />
              {label}
            </a>
          ))}
        </nav>
      </div>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
