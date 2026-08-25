// Leche — la pantalla que se llena en el corral. DOS modos, como el trabajo real:
//
//   · «Registrar total» — el total de CANTINA del ordeño. Un campo y guardar. Es
//     lo de casi todos los días, y por eso es el modo por defecto.
//   · «Control individual» — el conteo vaca por vaca, cada 2-3 semanas.
//
// Los dos pueden convivir en el mismo ordeño (db/07): la cantina es lo que se
// vendió y el desglose cómo se repartió. Cuando están los dos, la pantalla
// muestra el CUADRE entre ambos, que es el único momento en que se puede notar
// que alguien ordeñó en balde.
//
// El orden de la página ES el flujo del operario, y por eso el historial va
// ARRIBA: llega, mira si ya se registró ese ordeño, y si no, baja a teclear. Al
// guardar vuelve al mismo sitio y la fila nueva es lo primero que ve, con su
// nombre y la hora — que es lo que le deja darse cuenta de que guardó la tarde
// cuando quería guardar la mañana.
//
// Un ordeño a la vez, no dos columnas. La mañana se pesa a las 5 y la tarde a
// las 3: nadie llena las dos de una sentada (db/05).
//
// Sin JS de cliente: son <form> normales, así que se envían aunque el bundle no
// haya cargado. La única excepción es el <script> inline que suma el total en
// vivo del conteo individual: no es React, no entra al bundle y no hace falta
// para guardar — si no corre, el número se queda en «—».

import { getSesion } from '@/lib/auth/server';
import { puede } from '@/lib/auth/roles';
import { listarOrdeno, ultimosControles, type VacaOrdeno, type ControlReciente } from '@/lib/hato';
import { today, ordenoSugerido, selloEnFinca, ORDENO_LABEL, type Ordeno } from '@/lib/dates';
import { PantallaAcceso, SinPermiso } from '@/components/acceso';
import { Card, Table, TH, TD, Arete, EmptyRow, Banner, Badge } from '@/components/ui';
import { Texto, Numero, AreaTexto, Boton, ResultadoAccion, ETIQUETA } from '@/components/ui/form';
import { registrarControlAction, registrarTotalAction } from './actions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Modo = 'total' | 'individual';

const esOrdeno = (v: unknown): v is Ordeno => v === 'manana' || v === 'tarde';
const esModo = (v: unknown): v is Modo => v === 'total' || v === 'individual';

// Total en vivo del conteo individual. Vanilla y en un <script> suelto, NO un
// componente de cliente: el formulario sigue siendo HTML puro y se envía aunque
// el bundle nunca cargue — si esto no corre, lo único que falta es el número.
//
// Suma solo las casillas con algo escrito, así que el contador de vacas es
// también un detector: un `type="number"` con coma llega vacío al servidor en
// varios navegadores, y ahí se ve como «39 de 40» antes de guardar.
const TOTAL_EN_VIVO = `(function () {
  var f = document.getElementById('form-ordeno');
  if (!f) return;
  var salidaLitros = document.getElementById('total-litros');
  var salidaVacas = document.getElementById('total-vacas');
  if (!salidaLitros || !salidaVacas) return;
  function sumar() {
    var campos = f.querySelectorAll('input[name^="l:"]');
    var total = 0, llenas = 0;
    for (var i = 0; i < campos.length; i++) {
      var crudo = String(campos[i].value).trim();
      if (crudo === '') continue;
      var n = parseFloat(crudo.replace(',', '.'));
      if (isNaN(n)) continue;
      llenas++;
      total += n;
    }
    salidaLitros.textContent = llenas ? String(Math.round(total * 10) / 10) : '—';
    salidaVacas.textContent = String(llenas);
  }
  f.addEventListener('input', sumar);
  sumar();
})();`;

export default async function Leche({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; ordeno?: string; fecha?: string; modo?: string }>;
}) {
  const sesion = await getSesion();
  if (sesion.estado !== 'ok') return <PantallaAcceso sesion={sesion} />;
  if (!puede(sesion.usuario.rol, 'leche.registrar')) {
    return <SinPermiso rol={sesion.usuario.rol} que="registrar la producción de leche" />;
  }

  const params = await searchParams;
  const hoy = today();
  // El reloj de la finca elige por defecto, pero el operario manda: así se puede
  // registrar la mañana a las 2 de la tarde cuando hubo que salir a una cerca.
  const ordeno: Ordeno = esOrdeno(params.ordeno) ? params.ordeno : ordenoSugerido();
  const fecha = params.fecha && params.fecha <= hoy ? params.fecha : hoy;
  // Por defecto el total: es lo que se hace todos los días. El conteo individual
  // es una decisión consciente cada 2-3 semanas, y abrirlo cuesta un toque.
  const modo: Modo = esModo(params.modo) ? params.modo : 'total';

  // El hato solo hace falta para el conteo. En el modo total sería traer cuarenta
  // filas para no pintar ninguna.
  const [resVacas, resControles] = await Promise.allSettled([
    modo === 'individual' ? listarOrdeno() : Promise.resolve<VacaOrdeno[]>([]),
    ultimosControles(10),
  ]);
  const vacas: VacaOrdeno[] | null = resVacas.status === 'fulfilled' ? resVacas.value : null;
  const controles: ControlReciente[] = resControles.status === 'fulfilled' ? resControles.value : [];

  const fallos = [
    resVacas.status === 'rejected' && `Hato en ordeño — ${String(resVacas.reason?.message ?? resVacas.reason)}`,
    resControles.status === 'rejected' && `Historial — ${String(resControles.reason?.message ?? resControles.reason)}`,
  ].filter(Boolean) as string[];

  // Lo ya guardado para ESTE ordeño, por tipo. Son dos registros distintos: que
  // exista el total no impide el conteo, y avisar de lo contrario mandaría al
  // operario a borrar el dato bueno.
  const deEsteOrdeno = controles.filter((c) => c.fecha === fecha && c.ordeno === ordeno);
  const totalGuardado = deEsteOrdeno.find((c) => c.tipo === 'diario') ?? null;
  const conteoGuardado = deEsteOrdeno.find((c) => c.tipo === 'individual') ?? null;
  const yaRegistrado = modo === 'total' ? totalGuardado : conteoGuardado;

  // El cuadre solo existe cuando el ordeño tiene las dos mediciones.
  const cuadre =
    totalGuardado && conteoGuardado
      ? Math.round((totalGuardado.litros - conteoGuardado.litros) * 10) / 10
      : null;

  const conParams = (p: { modo?: Modo; ordeno?: Ordeno }) =>
    `/dashboard/leche?modo=${p.modo ?? modo}&ordeno=${p.ordeno ?? ordeno}&fecha=${fecha}`;

  return (
    <div className={`mx-auto max-w-3xl px-4 pt-5 sm:px-6 lg:px-8 ${modo === 'individual' ? 'pb-32' : 'pb-10'}`}>
      <a href="/dashboard" className="text-sm text-campo-700 hover:underline">← Volver al tablero</a>

      <header className="mb-5 mt-3">
        <h1 className="text-2xl font-semibold tracking-tight text-tierra-900">Producción de leche</h1>
        <p className="mt-1 text-sm text-tierra-500">
          Todos los días, el total de cantina de cada ordeño. Cada 2 o 3 semanas, el
          conteo vaca por vaca.
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
                <TH>Día</TH><TH>Ordeño</TH><TH>Registro</TH><TH>Litros</TH><TH>Guardado</TH>
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
                  <TD>
                    {c.tipo === 'diario' ? (
                      <Badge tono="neutro">Cantina</Badge>
                    ) : (
                      <Badge tono="campo">{c.vacas} {c.vacas === 1 ? 'vaca' : 'vacas'}</Badge>
                    )}
                  </TD>
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

      {/* ---- Selector de ordeño y de modo ----
          Enlaces, no radios: cambiarlos recarga la pantalla, así el historial y
          los avisos de abajo se recalculan solos. Sin JS de cliente. */}
      <div className="mb-3 flex items-center gap-2">
        {(['manana', 'tarde'] as const).map((o) => (
          <a
            key={o}
            href={conParams({ ordeno: o })}
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
      </div>

      <div className="mb-4 flex items-stretch gap-2">
        {[
          { id: 'total' as const, titulo: 'Registrar total', pie: 'un número de cantina' },
          { id: 'individual' as const, titulo: 'Control individual', pie: 'vaca por vaca' },
        ].map((m) => (
          <a
            key={m.id}
            href={conParams({ modo: m.id })}
            aria-current={m.id === modo ? 'true' : undefined}
            className={
              'flex-1 rounded-xl border px-3 py-2.5 text-center ' +
              (m.id === modo
                ? 'border-campo-500 bg-campo-50 text-campo-900 shadow-sm'
                : 'border-tierra-200 bg-white text-tierra-600 hover:border-campo-300')
            }
          >
            <span className="block text-base font-semibold">{m.titulo}</span>
            <span className="block text-xs text-tierra-500">{m.pie}</span>
          </a>
        ))}
      </div>

      {yaRegistrado && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50/80 p-3">
          <p className="text-sm leading-relaxed text-amber-900">
            <strong>
              {modo === 'total'
                ? `Ya hay un total de cantina de este ordeño: ${yaRegistrado.litros} L.`
                : `Ya hay un conteo individual de este ordeño: ${yaRegistrado.vacas} vacas, ${yaRegistrado.litros} L.`}
            </strong>{' '}
            Guardar otra vez lo rechaza — es lo que evita que un doble toque duplique los
            litros. Si hay que corregirlo, primero se borra.
          </p>
        </div>
      )}

      {cuadre !== null && (
        <div className="mb-4 rounded-xl border border-tierra-200 bg-white p-3">
          <p className="text-sm leading-relaxed text-tierra-700">
            <strong>Cuadre de este ordeño:</strong> cantina {totalGuardado!.litros} L contra{' '}
            {conteoGuardado!.litros} L del conteo ({conteoGuardado!.vacas} vacas) ={' '}
            <span className={Math.abs(cuadre) > 20 ? 'font-semibold text-red-700' : 'font-semibold'}>
              {cuadre > 0 ? '+' : ''}{cuadre} L
            </span>
            .
          </p>
          <p className="mt-1 text-xs leading-snug text-tierra-500">
            Unos litros de diferencia son normales (salpicadura, leche del ternero). Una
            diferencia grande suele ser una vaca ordeñada en balde o una casilla sin llenar.
          </p>
        </div>
      )}

      {/* ================= MODO 1: total de cantina ================= */}
      {modo === 'total' && (
        <form action={registrarTotalAction}>
          <input type="hidden" name="ordeno" value={ordeno} />
          <Card>
            <label className="block">
              <span className={ETIQUETA}>
                Litros de cantina · {ORDENO_LABEL[ordeno].toLowerCase()} del {fecha}
              </span>
              <span className="mt-1 block">
                <Numero
                  name="litros"
                  min={0}
                  max={5000}
                  autoFocus
                  required
                  placeholder="Ej. 428,5"
                  className="text-lg"
                  aria-label={`Litros de cantina del ordeño de la ${ORDENO_LABEL[ordeno].toLowerCase()}`}
                />
              </span>
            </label>

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

            <div className="mt-4 flex items-center justify-between gap-3 border-t border-tierra-100 pt-3">
              <span className="text-xs leading-snug text-tierra-500">
                Registra: {sesion.usuario.nombre}
              </span>
              <Boton className="px-6 py-3 text-base">Guardar total</Boton>
            </div>
          </Card>
        </form>
      )}

      {/* ================= MODO 2: conteo individual ================= */}
      {/* Ojo: el único campo `fecha` del formulario es el del <details>. Un
          <details> cerrado igual envía sus controles, así que un hidden aquí
          arriba sería un segundo `fecha` y formData.get() se quedaría con este,
          ignorando lo que el operario cambiara. */}
      {modo === 'individual' && (
        <form id="form-ordeno" action={registrarControlAction}>
          <input type="hidden" name="ordeno" value={ordeno} />

          <p className="mb-3 text-sm text-tierra-500">
            Deje en blanco la vaca que no ordeñó. Un 0 se guarda como «dio cero litros»,
            que no es lo mismo.
          </p>

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

          {/* Barra fija: con cuarenta vacas, un botón al final de la lista obliga
              a recorrerla entera para guardar. */}
          {vacas && vacas.length > 0 && (
            <>
              <div className="fixed inset-x-0 bottom-0 z-30 border-t border-tierra-200 bg-white/95 px-4 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] backdrop-blur">
                <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
                  <div className="min-w-0">
                    {/* Arranca en «—», no en «0 L»: mientras no haya nada tecleado,
                        un cero es una cifra falsa. */}
                    <p className="text-lg font-semibold leading-tight tabular-nums text-tierra-900">
                      <span id="total-litros">—</span> L
                      <span className="ml-2 text-xs font-normal tabular-nums text-tierra-500">
                        <span id="total-vacas">0</span> de {vacas.length} vacas
                      </span>
                    </p>
                    <p className="truncate text-xs leading-snug text-tierra-500">
                      {ORDENO_LABEL[ordeno]} · {fecha} · registra {sesion.usuario.nombre}
                    </p>
                  </div>
                  <Boton className="shrink-0 px-6 py-3 text-base">Guardar conteo</Boton>
                </div>
              </div>

              <script dangerouslySetInnerHTML={{ __html: TOTAL_EN_VIVO }} />
            </>
          )}
        </form>
      )}
    </div>
  );
}
