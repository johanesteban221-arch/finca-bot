import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Lazy singleton: the client is created on first use (request time), not at
// import/build time — so `next build` never depends on env vars being present.
let _client: SupabaseClient | null = null;

function client(): SupabaseClient {
  if (!_client) {
    _client = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return _client;
}

// Transparent proxy so callers keep using `supabase.from(...)` unchanged.
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const c = client() as any;
    const value = c[prop];
    return typeof value === 'function' ? value.bind(c) : value;
  },
});

export type QueryResult<T> = { data: T[] | null; error: { message: string } | null };

// supabase-js reports failures in `error` instead of throwing, so the common
// `data || []` idiom turns a broken query into a convincing empty result: a
// dashboard showing an empty herd, or a 6 AM alert claiming nothing is pending
// while a milk-withdrawal period is actually running. Read paths go through
// here so a failure is loud and the caller decides how to degrade.
//
// A successful PostgREST select always returns an array, so a null `data`
// without an error means "no rows" and is safely an empty list.
export function unwrapList<T>(res: QueryResult<T>, context: string): T[] {
  if (res.error) throw new Error(`consulta a ${context}: ${res.error.message}`);
  return res.data ?? [];
}

// ---------------------------------------------------------------------
// Paginación
//
// PostgREST corta toda respuesta en `max-rows` (1000 por defecto en Supabase) y
// NO avisa: llegan 1000 filas con `error: null`, exactamente igual que si esas
// fueran todas. Cualquier agregación en JS sobre una consulta sin paginar es
// entonces un número más bajo que el real, sin ningún síntoma — el mismo modo de
// falla que unwrapList existe para evitar, una capa más abajo.
//
// `paginar` recorre la consulta con `.range()` hasta que una página vuelve
// incompleta, que es la señal de que ya no hay más. Requisito de uso: la
// consulta debe traer un ORDEN TOTAL (una columna única al final, típicamente
// `id`). Sin desempate, dos filas con la misma fecha pueden intercambiarse entre
// una página y la siguiente, y entonces una se repite y otra se pierde.
// ---------------------------------------------------------------------
const PAGINA = 1000;
const MAX_PAGINAS = 25;

export async function paginar<T>(
  consulta: (desde: number, hasta: number) => PromiseLike<QueryResult<T>>,
  contexto: string,
): Promise<T[]> {
  const todo: T[] = [];
  for (let p = 0; p < MAX_PAGINAS; p++) {
    const desde = p * PAGINA;
    const filas = unwrapList<T>(await consulta(desde, desde + PAGINA - 1), contexto);
    todo.push(...filas);
    // Página corta = última página. Una página exacta pide otra vuelta, que
    // volverá vacía; es una consulta de más y evita adivinar.
    if (filas.length < PAGINA) return todo;
  }
  // Cortar en silencio aquí sería repetir el fallo que esto viene a arreglar.
  throw new Error(
    `consulta a ${contexto}: más de ${MAX_PAGINAS * PAGINA} filas. ` +
      'Es más de lo que este tablero agrega en memoria: hay que mover la ' +
      'agregación a SQL, como se hizo con vw_leche_ordeno en db/06.',
  );
}
