// Shell del tablero: barra lateral fija en escritorio, navegación horizontal
// desplazable en móvil. Sin estado ni JS de cliente — la navegación son anclas
// a las secciones de la página, así que todo sigue siendo server component.
//
// En Fase 3, cuando existan las rutas de /dashboard/registrar/*, estas anclas
// se vuelven enlaces reales y aquí entra el guardia de sesión (Fase 2).

import type { ReactNode } from 'react';
import {
  LayoutDashboard, Baby, Scale, Stethoscope, Skull, Milk, TriangleAlert,
} from 'lucide-react';

const SECCIONES = [
  { href: '#inventario', label: 'Inventario', Icon: LayoutDashboard },
  { href: '#reproductivo', label: 'Reproductivo', Icon: Baby },
  { href: '#peso', label: 'Peso y ganancia', Icon: Scale },
  { href: '#sanidad', label: 'Sanidad', Icon: Stethoscope },
  { href: '#mortalidad', label: 'Mortalidad', Icon: Skull },
  { href: '#leche', label: 'Leche', Icon: Milk },
  { href: '#alertas', label: 'Alertas', Icon: TriangleAlert },
];

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

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen lg:flex">
      {/* Barra lateral — escritorio */}
      <aside className="sticky top-0 z-20 hidden h-screen w-64 shrink-0 flex-col border-r border-campo-950/40 bg-campo-900 p-4 lg:flex">
        <Marca />
        <nav className="mt-6 flex-1 space-y-0.5">
          {SECCIONES.map(({ href, label, Icon }) => (
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
        <p className="mt-4 border-t border-campo-800 pt-3 text-xs leading-relaxed text-campo-300/80">
          Los registros entran por WhatsApp.
          <br />
          Formularios web: próximamente.
        </p>
      </aside>

      {/* Encabezado + navegación — móvil */}
      <div className="sticky top-0 z-20 bg-campo-900 lg:hidden">
        <div className="px-4 py-3">
          <Marca />
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
          {SECCIONES.map(({ href, label, Icon }) => (
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
