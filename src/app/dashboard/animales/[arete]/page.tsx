// Hoja de vida del animal — solo lectura (Bloque B).
//
// Tres consultas independientes con allSettled, igual que el tablero: si se cae
// la vista de genealogía, el historial se sigue viendo y la tarjeta caída lo
// dice. El animal en sí se consulta aparte porque sin él no hay página, y
// "no existe" y "no se pudo consultar" se muestran distinto a propósito.

import {
  getAnimalPorArete, getHistorial, getGenealogia, getCrias, edadTexto, fichaUrl,
  HISTORIAL_LIMITE,
  type Ancestro, type EventoHistorial,
} from '@/lib/ficha';
import { catTitle, sexoTitle } from '@/lib/animals';
import {
  Section, Card, Kpi, KpiRow, Badge, Table, TH, TD, EmptyRow, Banner, type Tono,
} from '@/components/ui';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const errorOf = (r: PromiseRejectedResult) =>
  r.reason instanceof Error ? r.reason.message : String(r.reason);

const ESTADO_TONO: Record<string, Tono> = {
  activo: 'campo', vendido: 'info', muerto: 'alerta', descartado: 'aviso',
};

const CATEGORIA_EVENTO: Record<string, { label: string; icono: string; tono: Tono }> = {
  reproductivo: { label: 'Reproductivo', icono: '🍼', tono: 'info' },
  chequeo_repro: { label: 'Chequeo', icono: '🔬', tono: 'info' },
  protocolo: { label: 'Protocolo', icono: '💉', tono: 'campo' },
  sanitario: { label: 'Sanidad', icono: '🩺', tono: 'alerta' },
  pesaje: { label: 'Peso', icono: '⚖️', tono: 'neutro' },
  produccion_leche: { label: 'Leche', icono: '🥛', tono: 'info' },
  movimiento: { label: 'Movimiento', icono: '📦', tono: 'aviso' },
};

// Vocabulario clínico del chequeo (ver CLAUDE.md). El código se conserva junto
// al significado: es lo que el veterinario dicta y lo que quedó en la base.
const ESTADO_CHEQUEO: Record<string, string> = {
  P: 'preñada',
  V: 'vacía',
  SE: 'servida',
  VAS: 'vacía · anestro superficial',
  VAP: 'vacía · anestro profundo',
  PP: 'post-parto',
  RECHE: 'rechequeo pendiente',
};

const ORDENO: Record<string, string> = {
  ordeno_manana: 'Ordeño de la mañana',
  ordeno_tarde: 'Ordeño de la tarde',
};

function nombreEvento(e: EventoHistorial): string {
  if (e.categoria === 'chequeo_repro') {
    return ESTADO_CHEQUEO[e.evento] ? `${e.evento} — ${ESTADO_CHEQUEO[e.evento]}` : e.evento;
  }
  if (e.categoria === 'produccion_leche') return ORDENO[e.evento] || e.evento;
  if (e.categoria === 'protocolo') return `Día ${e.evento.replace('dia_', '')} del protocolo`;
  return e.evento.replace(/_/g, ' ');
}

// ---------------------------------------------------------------------
// Árbol genealógico
// ---------------------------------------------------------------------
function Nodo({ rol, a }: { rol: string; a?: Ancestro }) {
  return (
    <div className="min-w-0 rounded-lg border border-tierra-200 bg-tierra-50/60 px-3 py-2">
      <div className="text-2xs font-semibold uppercase tracking-wide text-tierra-500">{rol}</div>
      <div className="truncate text-sm font-medium text-tierra-900">
        {!a?.arete ? (
          <span className="text-tierra-400">Sin registrar</span>
        ) : a.enSistema ? (
          <a
            href={fichaUrl(a.arete)}
            className="tabular-nums underline decoration-tierra-300 underline-offset-2 hover:text-campo-700 hover:decoration-campo-500"
          >
            {a.arete}
          </a>
        ) : (
          // Texto manual de la sección 1 de 03_hoja_de_vida.sql: hay nombre,
          // pero no hay animal al cual enlazar.
          <span title="Registrado como texto: no está en el hato">
            {a.arete} <span className="text-2xs font-normal text-tierra-400">externo</span>
          </span>
        )}
      </div>
    </div>
  );
}

function Rama({
  titulo, padre, abuelo, abuela,
}: { titulo: string; padre?: Ancestro; abuelo?: Ancestro; abuela?: Ancestro }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-tierra-500">{titulo}</h4>
      <Nodo rol={titulo === 'Vía paterna' ? 'Padre' : 'Madre'} a={padre} />
      <div className="ml-3 grid gap-2 border-l border-tierra-200 pl-3 sm:grid-cols-2">
        <Nodo rol="Abuelo" a={abuelo} />
        <Nodo rol="Abuela" a={abuela} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------
const Dato = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="min-w-0">
    <dt className="text-2xs font-semibold uppercase tracking-wide text-tierra-500">{label}</dt>
    <dd className="mt-0.5 text-sm text-tierra-900">{children}</dd>
  </div>
);

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <a href="/dashboard" className="text-sm text-campo-700 hover:underline">← Volver al tablero</a>
      <div className="mt-4">{children}</div>
    </div>
  );
}

export default async function FichaAnimal({ params }: { params: Promise<{ arete: string }> }) {
  const { arete: crudo } = await params;
  const arete = decodeURIComponent(crudo).trim();

  let animal;
  try {
    animal = await getAnimalPorArete(arete);
  } catch (e) {
    // Consulta caída: NO se puede decir "no existe". Ese mensaje mandaría a
    // registrar de nuevo un animal que sí está en la base.
    return (
      <Marco>
        <Banner fallos={[`Ficha del animal — ${e instanceof Error ? e.message : String(e)}`]} />
      </Marco>
    );
  }

  if (!animal) {
    return (
      <Marco>
        <Card title="Animal no encontrado">
          <p className="text-sm text-tierra-600">
            No hay ningún animal con arete <strong className="tabular-nums">{arete}</strong> en el
            hato. Revise el número; los registros entran por WhatsApp.
          </p>
        </Card>
      </Marco>
    );
  }

  const [histRes, genRes, criasRes] = await Promise.allSettled([
    getHistorial(animal.id), getGenealogia(animal.id), getCrias(animal),
  ]);

  const historial = histRes.status === 'fulfilled' ? histRes.value : null;
  const genealogia = genRes.status === 'fulfilled' ? genRes.value : null;
  const crias = criasRes.status === 'fulfilled' ? criasRes.value : null;

  const fallos = ([
    ['Historial del animal', histRes],
    ['Árbol genealógico', genRes],
    ['Crías', criasRes],
  ] as const)
    .filter(([, r]) => r.status === 'rejected')
    .map(([label, r]) => `${label} — ${errorOf(r as PromiseRejectedResult)}`);

  const edad = edadTexto(animal.fecha_nacimiento);
  // El historial ya viene ordenado de lo más nuevo a lo más viejo, así que el
  // primero de cada tipo es el último registrado. `descripcion` se muestra tal
  // cual la arma la vista ("480 kg"): no hay nada que parsear.
  const ultimoPeso = historial?.find((e) => e.categoria === 'pesaje') ?? null;
  const ultimoChequeo = historial?.find((e) => e.categoria === 'chequeo_repro') ?? null;

  return (
    <Marco>
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-tierra-900">
            🐄 Arete <span className="tabular-nums">{animal.arete}</span>
          </h1>
          {animal.nombre && <span className="text-xl text-tierra-500">— {animal.nombre}</span>}
          <Badge tono={ESTADO_TONO[animal.estado] || 'neutro'}>{animal.estado}</Badge>
          {animal.categoria && <Badge>{catTitle(animal.categoria)}</Badge>}
        </div>
        <p className="mt-1 text-sm text-tierra-500">
          Hoja de vida completa: historial unificado y genealogía. Solo lectura — los registros
          entran por WhatsApp.
        </p>
      </header>

      {fallos.length > 0 && <Banner fallos={fallos} />}

      <div className="space-y-8">
        <KpiRow>
          <Kpi label="Edad" value={edad ?? '—'} hint={animal.fecha_nacimiento ?? 'sin fecha de nacimiento'} />
          <Kpi
            label="Estado reproductivo"
            value={animal.estado_reproductivo ?? '—'}
            tono="info"
            hint={ultimoChequeo ? `último chequeo ${ultimoChequeo.fecha}` : 'sin chequeos registrados'}
          />
          <Kpi
            label="Último peso"
            value={ultimoPeso?.descripcion ?? '—'}
            tono="campo"
            hint={ultimoPeso ? ultimoPeso.fecha : 'sin pesajes registrados'}
          />
          <Kpi
            label="Eventos registrados"
            value={historial === null ? '—' : historial.length}
            hint={
              historial && historial.length >= HISTORIAL_LIMITE
                ? `se muestran los ${HISTORIAL_LIMITE} más recientes`
                : 'en toda su vida'
            }
          />
        </KpiRow>

        {/* --------------------------------------------------------- FICHA */}
        <Section id="datos" title="Datos del animal" icon="📇">
          <Card>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              <Dato label="Sexo">{sexoTitle(animal.sexo)}</Dato>
              <Dato label="Raza">{animal.raza || '—'}</Dato>
              <Dato label="Categoría">{animal.categoria ? catTitle(animal.categoria) : '—'}</Dato>
              <Dato label="Nacimiento">{animal.fecha_nacimiento || '—'}</Dato>
              <Dato label="Origen">{(animal.origen || '—').replace(/_/g, ' ')}</Dato>
              <Dato label="Peso al nacer">
                {animal.peso_nacimiento ? `${animal.peso_nacimiento} kg` : '—'}
              </Dato>
              <Dato label="Registro oficial">{animal.registro_oficial || '—'}</Dato>
              <Dato label="Foto">
                {animal.foto_url
                  ? <a href={animal.foto_url} className="text-campo-700 hover:underline">ver foto</a>
                  : '—'}
              </Dato>
            </dl>
            {animal.notas && (
              <p className="mt-4 border-t border-tierra-100 pt-3 text-sm text-tierra-600">
                <span className="font-medium text-tierra-700">Notas:</span> {animal.notas}
              </p>
            )}
          </Card>
        </Section>

        {/* --------------------------------------------------- GENEALOGÍA */}
        <Section id="genealogia" title="Árbol genealógico" icon="🌳" subtitle="tres generaciones">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Ascendencia">
              {genealogia === null ? (
                <p className="text-sm text-tierra-400">No se pudo cargar.</p>
              ) : (
                <div className="grid gap-5 sm:grid-cols-2">
                  <Rama
                    titulo="Vía paterna"
                    padre={genealogia.padre}
                    abuelo={genealogia.abueloPaterno}
                    abuela={genealogia.abuelaPaterna}
                  />
                  <Rama
                    titulo="Vía materna"
                    padre={genealogia.madre}
                    abuelo={genealogia.abueloMaterno}
                    abuela={genealogia.abuelaMaterna}
                  />
                </div>
              )}
            </Card>

            <Card title={animal.sexo === 'H' ? 'Crías' : 'Hijos registrados'}>
              <Table>
                <thead>
                  <tr><TH>Arete</TH><TH>Sexo</TH><TH>Nacimiento</TH><TH>Estado</TH></tr>
                </thead>
                <tbody>
                  {crias === null && <EmptyRow cols={4}>No se pudo cargar.</EmptyRow>}
                  {crias?.length === 0 && <EmptyRow cols={4}>Sin crías registradas.</EmptyRow>}
                  {crias?.map((c) => (
                    <tr key={c.id}>
                      <TD>
                        <a
                          href={fichaUrl(c.arete)}
                          className="font-semibold tabular-nums underline decoration-tierra-300 underline-offset-2 hover:text-campo-700"
                        >
                          {c.arete}
                        </a>
                        {c.nombre && <span className="ml-1 text-tierra-500">{c.nombre}</span>}
                      </TD>
                      <TD>{sexoTitle(c.sexo)}</TD>
                      <TD className="whitespace-nowrap tabular-nums">{c.fecha_nacimiento || '—'}</TD>
                      <TD>
                        <Badge tono={ESTADO_TONO[c.estado] || 'neutro'}>{c.estado}</Badge>
                      </TD>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          </div>
        </Section>

        {/* ----------------------------------------------------- HISTORIAL */}
        <Section
          id="historial"
          title="Historial unificado"
          icon="📜"
          subtitle="sanidad, reproducción, chequeos, protocolos, peso, leche y movimientos"
        >
          <Card>
            <Table>
              <thead>
                <tr><TH>Fecha</TH><TH>Tipo</TH><TH>Evento</TH><TH>Detalle</TH></tr>
              </thead>
              <tbody>
                {historial === null && <EmptyRow cols={4}>No se pudo cargar el historial.</EmptyRow>}
                {historial?.length === 0 && (
                  <EmptyRow cols={4}>Todavía no hay eventos registrados para este animal.</EmptyRow>
                )}
                {historial?.map((e, i) => {
                  const cat = CATEGORIA_EVENTO[e.categoria] ?? {
                    label: e.categoria, icono: '•', tono: 'neutro' as Tono,
                  };
                  return (
                    <tr key={e.ref_id || `${e.categoria}-${e.fecha}-${i}`}>
                      <TD className="whitespace-nowrap tabular-nums">{e.fecha}</TD>
                      <TD className="whitespace-nowrap">
                        <Badge tono={cat.tono}>{cat.icono} {cat.label}</Badge>
                      </TD>
                      <TD className="whitespace-nowrap first-letter:uppercase">{nombreEvento(e)}</TD>
                      <TD className="text-tierra-600">{e.descripcion?.trim() || '—'}</TD>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
        </Section>
      </div>
    </Marco>
  );
}
