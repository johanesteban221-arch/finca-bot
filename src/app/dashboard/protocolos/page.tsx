// Protocolos de sincronización — Bloque D, #3.
//
// La pantalla se organiza al revés que las otras dos: primero los protocolos
// ABIERTOS y solo al final el de arrancar uno nuevo. Un protocolo es un ciclo de
// días (0, 7, 9…), así que lo que el veterinario hace el 95% de las veces que
// entra aquí es avanzar uno que ya existe, no crear otro.
//
// Cada protocolo abierto lleva sus formularios en línea. Se ven repetidos, pero
// un solo formulario con un selector de protocolo sería un clic más y un error
// posible: aplicarle el CIDR a la vaca equivocada.

import { getSesion } from '@/lib/auth/server';
import { puede } from '@/lib/auth/roles';
import { listarHembrasActivas, protocolosAbiertos, type VacaOrdeno, type ProtocoloAbierto } from '@/lib/hato';
import { today, daysBetween } from '@/lib/dates';
import { PantallaAcceso, SinPermiso } from '@/components/acceso';
import { Section, Card, Badge, Banner } from '@/components/ui';
import { Campo, Texto, Numero, Seleccion, AreaTexto, Boton, ResultadoAccion } from '@/components/ui/form';
import {
  iniciarProtocoloAction, registrarAplicacionAction, registrarIaAction,
  cerrarProtocoloAction, cancelarProtocoloAction,
} from './actions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function Abierto({ p, hoy }: { p: ProtocoloAbierto; hoy: string }) {
  // Día del protocolo = días desde el inicio. Es lo que el veterinario tiene en
  // la cabeza ("hoy toca el día 7"), y calcularlo aquí evita que lo cuente con
  // los dedos sobre el calendario.
  const dia = daysBetween(p.fechaInicio, hoy);

  return (
    <Card
      title={`${p.arete}${p.nombre ? ` · ${p.nombre}` : ''} — ${p.nombreProtocolo}`}
      action={<Badge tono={p.fechaIa ? 'info' : 'campo'}>{p.fechaIa ? 'inseminada' : `día ${dia}`}</Badge>}
    >
      <p className="mb-4 text-xs text-tierra-500">
        Inicio {p.fechaInicio} · {p.aplicaciones} {p.aplicaciones === 1 ? 'aplicación' : 'aplicaciones'}
        {p.fechaIa && ` · IA el ${p.fechaIa}`}
      </p>

      <div className="space-y-4">
        {/* --- Aplicación del día --- */}
        {!p.fechaIa && (
          <form action={registrarAplicacionAction} className="rounded-lg border border-tierra-200 p-3">
            <input type="hidden" name="protocoloId" value={p.id} />
            <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-tierra-500">
              Registrar aplicación
            </p>
            <div className="grid gap-3 sm:grid-cols-5">
              <Campo label="Día">
                <Numero name="diaNumero" defaultValue={dia} min={0} max={60} step={1} required />
              </Campo>
              <Campo label="Producto">
                <Texto name="producto" placeholder="GnRH, PGF2α…" required />
              </Campo>
              <Campo label="Dosis">
                <Texto name="dosis" placeholder="2 mL" />
              </Campo>
              <Campo label="Vía">
                <Texto name="via" placeholder="IM" />
              </Campo>
              <Campo label="Fecha">
                <Texto type="date" name="fecha" defaultValue={hoy} max={hoy} required />
              </Campo>
            </div>
            <input type="hidden" name="aplicadoPor" value="" />
            <div className="mt-3">
              <Boton tono="secundario">Guardar aplicación</Boton>
            </div>
          </form>
        )}

        {/* --- IA --- */}
        {!p.fechaIa && (
          <form action={registrarIaAction} className="rounded-lg border border-tierra-200 p-3">
            <input type="hidden" name="protocoloId" value={p.id} />
            <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-tierra-500">
              Inseminar
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo label="Inseminador">
                <Texto name="inseminador" required />
              </Campo>
              <Campo label="Pajilla">
                <Texto name="pajilla" />
              </Campo>
              <Campo label="Fecha">
                <Texto type="date" name="fecha" defaultValue={hoy} max={hoy} required />
              </Campo>
            </div>
            <div className="mt-3">
              <Boton tono="secundario">Registrar IA</Boton>
            </div>
          </form>
        )}

        {/* --- Cierre: solo con IA registrada (ck_protocolos_resultado) --- */}
        {p.fechaIa && (
          <form action={cerrarProtocoloAction} className="rounded-lg border border-tierra-200 p-3">
            <input type="hidden" name="protocoloId" value={p.id} />
            <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-tierra-500">
              Cerrar con el diagnóstico
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo label="Resultado">
                <Seleccion name="resultado" defaultValue="" required>
                  <option value="" disabled>Elija…</option>
                  <option value="preno">Preñada</option>
                  <option value="no_preno">Vacía</option>
                </Seleccion>
              </Campo>
              <Campo label="Fecha del diagnóstico">
                <Texto type="date" name="fecha" defaultValue={hoy} max={hoy} required />
              </Campo>
            </div>
            <div className="mt-3">
              <Boton>Cerrar protocolo</Boton>
            </div>
          </form>
        )}

        {/* --- Cancelar --- */}
        <form action={cancelarProtocoloAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="protocoloId" value={p.id} />
          <Campo label="Cancelar — motivo" className="min-w-48 flex-1">
            <Texto name="motivo" placeholder="Se cayó el CIDR, vaca vendida…" />
          </Campo>
          <Boton tono="peligro">Cancelar protocolo</Boton>
        </form>
      </div>
    </Card>
  );
}

export default async function Protocolos({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; arete?: string }>;
}) {
  const sesion = await getSesion();
  if (sesion.estado !== 'ok') return <PantallaAcceso sesion={sesion} />;
  if (!puede(sesion.usuario.rol, 'protocolo.registrar')) {
    return <SinPermiso rol={sesion.usuario.rol} que="manejar protocolos de sincronización" />;
  }

  const { ok, error, arete } = await searchParams;
  const hoy = today();

  const [resAbiertos, resHembras] = await Promise.allSettled([
    protocolosAbiertos(),
    listarHembrasActivas(),
  ]);
  const abiertos: ProtocoloAbierto[] | null = resAbiertos.status === 'fulfilled' ? resAbiertos.value : null;
  const hembras: VacaOrdeno[] = resHembras.status === 'fulfilled' ? resHembras.value : [];

  const fallos = [
    resAbiertos.status === 'rejected' && `Protocolos abiertos — ${String(resAbiertos.reason?.message ?? resAbiertos.reason)}`,
    resHembras.status === 'rejected' && `Lista de hembras — ${String(resHembras.reason?.message ?? resHembras.reason)}`,
  ].filter(Boolean) as string[];

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <a href="/dashboard" className="text-sm text-campo-700 hover:underline">← Volver al tablero</a>

      <header className="mb-6 mt-4">
        <h1 className="text-2xl font-semibold tracking-tight text-tierra-900">
          Protocolos de sincronización
        </h1>
        <p className="mt-1 text-sm text-tierra-500">
          Cada producto que aplique se guarda como evento sanitario con su retiro de leche, y la
          IA queda como servicio en la hoja de vida del animal.
        </p>
      </header>

      {fallos.length > 0 && <Banner fallos={fallos} />}
      <ResultadoAccion ok={ok} error={error} />

      <div className="space-y-8">
        <Section
          title="En curso"
          icon="🔄"
          subtitle={abiertos ? `${abiertos.length} abierto${abiertos.length === 1 ? '' : 's'}` : undefined}
        >
          {abiertos === null && (
            <Card><p className="text-sm text-tierra-500">No se pudieron cargar los protocolos.</p></Card>
          )}
          {abiertos?.length === 0 && (
            <Card>
              <p className="text-sm text-tierra-500">
                No hay protocolos abiertos. Empiece uno abajo.
              </p>
            </Card>
          )}
          <div className="space-y-4">
            {abiertos?.map((p) => <Abierto key={p.id} p={p} hoy={hoy} />)}
          </div>
        </Section>

        <Section title="Empezar un protocolo" icon="▶️" id="nuevo">
          <Card>
            <form action={iniciarProtocoloAction} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo label="Arete" hint="Solo un protocolo abierto por animal a la vez.">
                  <Texto
                    name="arete"
                    list="hembras-protocolo"
                    defaultValue={arete ?? ''}
                    required
                    maxLength={15}
                    autoComplete="off"
                  />
                </Campo>
                <Campo label="Protocolo">
                  <Texto name="nombreProtocolo" placeholder="Ovsynch, J-Synch, CIDR 7 días…" required />
                </Campo>
                <Campo label="Fecha de inicio" hint="Es el día 0.">
                  <Texto type="date" name="fecha" defaultValue={hoy} max={hoy} required />
                </Campo>
                <Campo label="Veterinario">
                  <Texto name="veterinario" defaultValue={sesion.usuario.nombre} />
                </Campo>
              </div>

              <datalist id="hembras-protocolo">
                {hembras.map((h) => (
                  <option key={h.id} value={h.arete}>{h.nombre ?? ''}</option>
                ))}
              </datalist>

              <Campo label="Notas (opcional)">
                <AreaTexto name="notas" />
              </Campo>

              <Boton>Iniciar protocolo</Boton>
            </form>
          </Card>
        </Section>
      </div>
    </div>
  );
}
