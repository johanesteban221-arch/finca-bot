// Primitivas de UI del tablero. Server components puros: no hay estado ni
// interactividad todavía, así que nada de 'use client'.

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------
// Estructura
// ---------------------------------------------------------------------
export function Section({
  title, icon, subtitle, id, children,
}: {
  title: string; icon?: ReactNode; subtitle?: string; id?: string; children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6">
      <div className="mb-3 flex items-baseline gap-2">
        {icon && <span className="text-campo-600 shrink-0">{icon}</span>}
        <h2 className="text-lg font-semibold tracking-tight text-tierra-900">{title}</h2>
        {subtitle && <span className="text-sm text-tierra-500">{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

export function Card({
  title, action, className, children,
}: {
  title?: string; action?: ReactNode; className?: string; children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-tierra-200/80 bg-white shadow-sm',
        'shadow-tierra-900/[0.04]',
        className,
      )}
    >
      {title && (
        <div className="flex items-center justify-between gap-2 border-b border-tierra-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-tierra-800">{title}</h3>
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------
// KPI
// ---------------------------------------------------------------------
const TONOS = {
  neutro: 'text-tierra-900',
  campo: 'text-campo-700',
  alerta: 'text-red-700',
  aviso: 'text-amber-700',
  info: 'text-blue-700',
} as const;

export type Tono = keyof typeof TONOS;

export function Kpi({
  label, value, tono = 'neutro', hint,
}: {
  label: string; value: string | number; tono?: Tono; hint?: string;
}) {
  return (
    <div className="min-w-[9rem] flex-1 rounded-xl border border-tierra-200/80 bg-white px-4 py-3 shadow-sm shadow-tierra-900/[0.04]">
      <div className={cn('text-2xl font-semibold tabular-nums tracking-tight', TONOS[tono])}>
        {value}
      </div>
      <div className="mt-0.5 text-sm text-tierra-600">{label}</div>
      {hint && <div className="mt-1 text-xs leading-snug text-tierra-400">{hint}</div>}
    </div>
  );
}

export const KpiRow = ({ children }: { children: ReactNode }) => (
  <div className="mb-4 flex flex-wrap gap-3">{children}</div>
);

// ---------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------
const BADGE = {
  neutro: 'bg-tierra-100 text-tierra-700 ring-tierra-200',
  campo: 'bg-campo-50 text-campo-700 ring-campo-200',
  alerta: 'bg-red-50 text-red-700 ring-red-200',
  aviso: 'bg-amber-50 text-amber-800 ring-amber-200',
  info: 'bg-blue-50 text-blue-700 ring-blue-200',
} as const;

export const Badge = ({ tono = 'neutro', children }: { tono?: Tono; children: ReactNode }) => (
  <span
    className={cn(
      'inline-flex items-center whitespace-nowrap rounded-md px-1.5 py-0.5',
      'text-xs font-medium ring-1 ring-inset',
      BADGE[tono],
    )}
  >
    {children}
  </span>
);

// ---------------------------------------------------------------------
// Tabla
//
// El contenedor scrollea en horizontal por su cuenta: en un celular en el
// potrero, la página nunca debe desbordarse.
// ---------------------------------------------------------------------
export const Table = ({ children }: { children: ReactNode }) => (
  <div className="-mx-4 overflow-x-auto px-4">
    <table className="w-full min-w-full border-collapse text-sm">{children}</table>
  </div>
);

export const TH = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th
    className={cn(
      'border-b border-tierra-200 pb-2 pr-3 text-left',
      'text-2xs font-semibold uppercase tracking-wide text-tierra-500',
      className,
    )}
  >
    {children}
  </th>
);

export const TD = ({
  children, className, title,
}: { children?: ReactNode; className?: string; title?: string }) => (
  <td
    title={title}
    className={cn('border-b border-tierra-100 py-2 pr-3 align-middle text-tierra-800', className)}
  >
    {children}
  </td>
);

export const Arete = ({ children }: { children: ReactNode }) => (
  <span className="font-semibold tabular-nums text-tierra-900">{children}</span>
);

export const EmptyRow = ({ cols, children }: { cols: number; children: ReactNode }) => (
  <tr>
    <td colSpan={cols} className="py-6 text-center text-sm text-tierra-400">
      {children}
    </td>
  </tr>
);

// ---------------------------------------------------------------------
// Barras horizontales
// ---------------------------------------------------------------------
export function Bars({ data, tono = 'campo' }: { data: Record<string, number>; tono?: 'campo' | 'alerta' }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  const fill = tono === 'alerta' ? 'bg-red-500' : 'bg-campo-500';

  if (entries.length === 0) {
    return <p className="py-4 text-center text-sm text-tierra-400">Sin datos todavía.</p>;
  }

  return (
    <ul className="space-y-2">
      {entries.map(([k, v]) => (
        <li key={k} className="flex items-center gap-3">
          <span className="w-28 shrink-0 truncate text-sm capitalize text-tierra-700" title={k}>
            {k.replace(/_/g, ' ')}
          </span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-tierra-100">
            <span className={cn('block h-full rounded-full', fill)} style={{ width: `${(v / max) * 100}%` }} />
          </span>
          <span className="w-8 shrink-0 text-right text-sm font-semibold tabular-nums text-tierra-800">{v}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------
// Aviso de datos incompletos
// ---------------------------------------------------------------------
export function Banner({ fallos }: { fallos: string[] }) {
  return (
    <div className="mb-6 rounded-xl border border-red-200 bg-red-50/70 p-4">
      <h2 className="text-sm font-semibold text-red-800">⚠️ Datos incompletos</h2>
      <p className="mt-1 text-sm text-red-900/80">
        No se pudieron cargar algunos indicadores. Lo que falta aparece como «—», no como cero.
      </p>
      <ul className="mt-2 space-y-0.5 pl-4 text-xs text-red-900/70">
        {fallos.map((f) => (
          <li key={f} className="list-disc">{f}</li>
        ))}
      </ul>
    </div>
  );
}
