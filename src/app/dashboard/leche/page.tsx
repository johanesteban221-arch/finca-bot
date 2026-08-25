// Control lechero — la pantalla que se llena en el corral (Bloque D, #1).
//
// El orden de la página ES el flujo del operario, y por eso el historial va
// ARRIBA: llega, mira si ya se registró ese ordeño, y si no, baja tecleando. Al
// guardar vuelve al mismo sitio y la fila nueva es lo primero que ve, con su
// nombre y la hora — que es lo que le deja darse cuenta de que guardó la tarde
// cuando quería guardar la mañana.
//
// Un ordeño a la vez, no dos columnas. La mañana se pesa a las 5 y la tarde a
// las 3: nadie llena las dos de una sentada, y el esquema ahora lo refleja (un
// control por finca, fecha Y ordeño — db/05).
//
// Sin JS de cliente: es un <form> normal, así que se envía aunque el bundle no
// haya cargado. La barra de guardar es CSS `sticky`, no JavaScript.

import { getSesion } from '@/lib/auth/server';
import { puede } from '@/lib/auth/roles';
import { listarOrdeno, ultimosControles, type VacaOrdeno, type ControlReciente } from '@/lib/hato';
import { today, ordenoSugerido, selloEnFinca, ORDENO_LABEL, type Ordeno } from '@/lib/dates';
import { PantallaAcceso, SinPermiso } from '@/components/acceso';
import { Card, Table, TH, TD, Arete, EmptyRow, Banner, Badge } from '@/components/ui';
import { Texto, Numero, AreaTexto, Boton, ResultadoAccion, ETIQUETA } from '@/components/ui/form';
import { registrarControlAction } from './actions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const esOrdeno = (v: unknown): v is Ordeno => v === 'manana' || v === 'tarde';

export default async function ControlLeche({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; ordeno?: string; fecha?: string }>;
}) {
  const sesion = await getSesion();
  if (sesion.estado !== 'ok') return <PantallaAcceso sesion={sesion} />;
  if (!puede(sesion.usuario.rol, 'leche.registrar')) {
    return <SinPermiso rol={sesion.usuario.rol} que="registrar el control lechero" />;
  }

  const params = await searchParams;
  const hoy = today();
  // El reloj de la finca elige por defecto, pero el operario manda: así se puede
  // registrar la mañana a las 2 de la tarde cuando hubo que salir a una cerca.
  const ordeno: Ordeno = esOrdeno(params.ordeno) ? params.ordeno : ordenoSugerido();
  const fecha = params.fecha && params.fecha <= hoy ? params.fecha : hoy;

  const [resVacas, resControles] = await Promise.allSettled([listarOrdeno(), ultimosControles()]);
  const vacas: VacaOrdeno[] | null = resVacas.status === 'fulfilled' ? resVacas.value : null;
  const controles: ControlReciente[] = resControles.status === 'fulfilled' ? resControles.value : [];

  const fallos = [
    resVacas.status === 'rejected' && `Hato en ordeño — ${String(resVacas.reason?.message ?? resVacas.reason)}`,
    resControles.status === 'rejected' && `Historial — ${String(resControles.reason?.message ?? resControles.reason)}`,
  ].filter(Boolean) as string[];

  const yaRegistrado = controles.some((c) => c.fecha === fecha && c.ordeno === ordeno);

  return (
    <div className="mx-auto max-w-3xl px-4 pb-32 pt-5 sm:px-6 lg:px-8">
      <a href="/dashboard" className="text-sm text-campo-700 hover:underline">← Volver al tablero</a>

      <header className="mb-5 mt-3">
        <h1 className="text-2xl font-semibold tracking-tight text-tierra-900">Control lechero</h1>
        <p className="mt-1 text-sm text-tierra-500">
          Deje en blanco la vaca que no ordeñó. Un 0 se guarda como «dio cero litros»,
          que no es lo mismo.
        </p>
      </header>

      {fallos.length > 0 && <Banner fallos={fallos} />}
      <ResultadoAccion ok={params.ok} error={params.error} />

      {/* ---- Historial: primero, porque es lo que se viene a verificar ---- */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-tierra-800">Últimos ordeños registrados</h2>
        <Card>
          <Table>
            <thead>
              <tr>
                <TH>Día</TH><TH>Ordeño</TH><TH>Vacas</TH><TH>Litros</TH><TH>Guardado</TH>
              </tr>
            </thead>
            <tbody>
              {controles.length === 0 && (
                <EmptyRow cols={5}>Todavía no hay ninguno. El primero es el de abajo.</EmptyRow>
              )}
              {controles.map((c) => (
                <tr key={c.id}>
                  <TD className="whitespace-nowrap tabular-nums">{c.fecha}</TD>
                  <TD>
                    <Badge tono={c.ordeno === 'manana' ? 'aviso' : 'info'}>
                      {ORDENO_LABEL[c.ordeno]}
                    </Badge>
                  </TD>
                  <TD className="tabular-nums">{c.vacas}</TD>
                  <TD className="whitespace-nowrap font-semibold tabular-nums">{c.litros} L</TD>
                  <TD className="text-xs text-tierra-500">
                    {selloEnFinca(c.guardadoEn)}
                    {c.medidoPor && <span className="block">{c.medidoPor}</span>}
                  </TD>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </section>

      {/* ---- El formulario ---- */}
      {/* Ojo: el único campo `fecha` del formulario es el del <details> de abajo.
          Un <details> cerrado igual envía sus controles, así que un hidden aquí
          arriba sería un segundo `fecha` y formData.get() se quedaría con este,
          ignorando lo que el operario cambiara. */}
      <form action={registrarControlAction}>
        {/* Selector de ordeño: enlaces, no radios, para que cambiarlo recargue la
            pantalla y el historial de arriba se filtre solo. Sin JS de cliente. */}
        <div className="mb-4 flex items-center gap-2">
          {(['manana', 'tarde'] as const).map((o) => (
            <a
              key={o}
              href={`/dashboard/leche?ordeno=${o}&fecha=${fecha}`}
              aria-current={o === ordeno ? 'true' : undefined}
              className={
                o === ordeno
                  ? 'rounded-lg bg-campo-600 px-4 py-2.5 text-base font-semibold text-white shadow-sm'
                  : 'rounded-lg border border-tierra-200 bg-white px-4 py-2.5 text-base font-medium text-tierra-600 hover:border-campo-300'
              }
            >
              {o === 'manana' ? '🌅' : '🌇'} {ORDENO_LABEL[o]}
            </a>
          ))}
          <input type="hidden" name="ordeno" value={ordeno} />
        </div>

        {yaRegistrado && (
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50/80 p-3">
            <p className="text-sm leading-relaxed text-amber-900">
              <strong>Este ordeño ya está registrado.</strong> Guardar otra vez lo rechaza —
              es lo que evita que un doble toque duplique los litros. Si hay que corregirlo,
              primero se borra.
            </p>
          </div>
        )}

        <Card>
          <Table>
            <thead>
              <tr>
                <TH>Vaca</TH>
                <TH className="w-32 text-right">Litros</TH>
              </tr>
            </thead>
            <tbody>
              {vacas === null && (
                <EmptyRow cols={2}>No se pudo cargar el hato. No guarde: faltarían vacas.</EmptyRow>
              )}
              {vacas?.length === 0 && (
                <EmptyRow cols={2}>
                  No hay vacas en ordeño. Se listan las activas de categoría «vaca» que no estén secas.
                </EmptyRow>
              )}
              {vacas?.map((v) => (
                <tr key={v.id}>
                  <TD>
                    <Arete href={`/dashboard/animales/${encodeURIComponent(v.arete)}`}>{v.arete}</Arete>
                    {v.nombre && <span className="block text-xs text-tierra-500">{v.nombre}</span>}
                  </TD>
                  <TD>
                    <Numero
                      name={`l:${v.arete}`}
                      min={0}
                      max={50}
                      placeholder="—"
                      className="text-right"
                      aria-label={`Litros de la vaca ${v.arete}, ordeño de la ${ORDENO_LABEL[ordeno].toLowerCase()}`}
                    />
                  </TD>
                </tr>
              ))}
            </tbody>
          </Table>

          <details className="mt-4 border-t border-tierra-100 pt-3">
            <summary className="cursor-pointer text-xs font-medium text-tierra-500 hover:text-campo-700">
              Cambiar la fecha o añadir una nota
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className={ETIQUETA}>Fecha del ordeño</span>
                <span className="mt-1 block">
                  <Texto type="date" name="fecha" defaultValue={fecha} max={hoy} required />
                </span>
              </label>
              <label className="block">
                <span className={ETIQUETA}>Nota (opcional)</span>
                <span className="mt-1 block">
                  <AreaTexto name="notas" placeholder="Clima, cambio de potrero…" />
                </span>
              </label>
            </div>
          </details>
        </Card>

        {/* Barra fija: con cuarenta vacas, un botón al final de la lista obliga a
            recorrerla entera para guardar. */}
        {!!vacas?.length && (
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-tierra-200 bg-white/95 px-4 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] backdrop-blur">
            <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
              <span className="text-xs leading-snug text-tierra-500">
                {ORDENO_LABEL[ordeno]} · {fecha}
                <span className="block">Registra: {sesion.usuario.nombre}</span>
              </span>
              <Boton className="px-6 py-3 text-base">Guardar ordeño</Boton>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
