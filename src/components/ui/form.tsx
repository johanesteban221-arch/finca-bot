// Primitivas de formulario del tablero (Bloque D).
//
// Server components puros, igual que el resto de `ui/`: los tres formularios de
// Bloque D son `<form action={serverAction}>` sin una línea de JS de cliente.
// Eso no es purismo — es que estas pantallas se llenan en el corral, con una
// mano, en un celular con señal intermitente. Un formulario HTML normal se
// envía aunque el bundle nunca haya cargado; uno controlado por React, no.
//
// Los dos únicos 'use client' del proyecto siguen siendo las pantallas que
// muestran una contraseña, y por un motivo distinto (no pasarla por la URL).

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

// ⚠️ `text-base` (16px) no es una decisión estética: Safari en iOS hace ZOOM
// automático sobre cualquier campo de menos de 16px al enfocarlo. Con `text-sm`
// (14px), llenar el control lechero eran cuarenta zooms y cuarenta
// reposicionamientos — el formulario se veía bien en el escritorio y era
// inusable en el corral.
//
// La condición es `pointer: fine` (ratón), NO un breakpoint de ancho: un iPhone
// en horizontal mide 844px y con `sm:` volvería a 14px justo donde el zoom sigue
// pasando. Lo que importa es con qué se toca la pantalla, no cuánto mide.
const BASE_CAMPO =
  'w-full rounded-lg border border-tierra-200 bg-white px-3 py-2.5 text-base ' +
  '[@media(pointer:fine)]:py-2 [@media(pointer:fine)]:text-sm ' +
  'text-tierra-900 outline-none focus:border-campo-500 focus:ring-2 focus:ring-campo-200 ' +
  'disabled:bg-tierra-50 disabled:text-tierra-400';

export const ETIQUETA = 'text-2xs font-semibold uppercase tracking-wide text-tierra-500';

export function Campo({
  label, hint, children, className,
}: {
  label: string; hint?: string; children: ReactNode; className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className={ETIQUETA}>{label}</span>
      <span className="mt-1 block">{children}</span>
      {hint && <span className="mt-1 block text-xs leading-snug text-tierra-400">{hint}</span>}
    </label>
  );
}

export const Texto = (p: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input {...p} className={cn(BASE_CAMPO, p.className)} />
);

// `inputMode="decimal"` abre el teclado numérico del celular sin bloquear la
// coma: en el corral se teclea «8,5» tan a menudo como «8.5», y la acción
// normaliza las dos. `step="any"` evita que el navegador rechace el decimal.
export const Numero = (p: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    type="number"
    inputMode="decimal"
    step="any"
    {...p}
    className={cn(BASE_CAMPO, 'tabular-nums', p.className)}
  />
);

export const Seleccion = (
  p: React.SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode },
) => <select {...p} className={cn(BASE_CAMPO, p.className)} />;

export const AreaTexto = (p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea rows={2} {...p} className={cn(BASE_CAMPO, 'resize-y', p.className)} />
);

export function Boton({
  children, tono = 'primario', className, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tono?: 'primario' | 'secundario' | 'peligro' }) {
  const tonos = {
    primario: 'bg-campo-600 text-white hover:bg-campo-700',
    secundario: 'border border-tierra-200 bg-white text-tierra-700 hover:border-campo-300 hover:text-campo-800',
    peligro: 'border border-tierra-200 bg-white text-tierra-700 hover:border-red-300 hover:text-red-700',
  } as const;
  return (
    <button
      type="submit"
      {...rest}
      className={cn(
        'rounded-lg px-3 py-2 text-sm font-semibold shadow-sm disabled:opacity-60',
        tonos[tono],
        className,
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------
// Resultado de una acción
//
// Llega por la URL (`?ok=…` / `?error=…`) y no por estado de React, que es lo
// que permite que estas páginas sigan siendo server components. Ningún dato
// sensible pasa por aquí: son confirmaciones y mensajes de validación. Las
// contraseñas temporales son el caso contrario y por eso viven en un
// 'use client' aparte.
// ---------------------------------------------------------------------
export function Aviso({ tono, children }: { tono: 'ok' | 'error'; children: ReactNode }) {
  const estilo =
    tono === 'ok'
      ? 'border-campo-300 bg-campo-50 text-campo-900'
      : 'border-red-200 bg-red-50 text-red-800';
  return (
    <p
      role={tono === 'error' ? 'alert' : 'status'}
      className={cn('mb-4 rounded-lg border px-3 py-2 text-sm', estilo)}
    >
      {tono === 'ok' ? '✅ ' : '⚠️ '}
      {children}
    </p>
  );
}

/** Pinta el `?ok=` / `?error=` que dejó el redirect de una server action. */
export function ResultadoAccion({ ok, error }: { ok?: string; error?: string }) {
  if (error) return <Aviso tono="error">{error}</Aviso>;
  if (ok) return <Aviso tono="ok">{ok}</Aviso>;
  return null;
}
