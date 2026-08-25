// Lectura de FormData para los formularios del tablero (Bloque D).
//
// Existe por una sola razón: `formData.get()` devuelve `string | File | null` y
// los esquemas de `domain/schemas.ts` esperan `number | null` y `string | null`
// ya limpios. Sin este paso intermedio cada acción improvisa su propio
// `Number(String(...))`, y el día que uno olvide el caso «campo vacío» mandará
// un `NaN` o un `0` al dominio. Un 0 es una lectura VÁLIDA de litros (la vaca no
// dio nada ese ordeño), así que confundirlo con «no medida» no da error: guarda
// un dato falso.
//
// Los errores se lanzan como `CampoInvalido` para que la acción los muestre
// junto al nombre del campo en vez de un «NaN» sin contexto.

export class CampoInvalido extends Error {
  constructor(readonly campo: string, mensaje: string) {
    super(mensaje);
    this.name = 'CampoInvalido';
  }
}

const crudo = (fd: FormData, name: string): string =>
  typeof fd.get(name) === 'string' ? (fd.get(name) as string).trim() : '';

/** Texto obligatorio. */
export function texto(fd: FormData, name: string, etiqueta = name): string {
  const v = crudo(fd, name);
  if (!v) throw new CampoInvalido(name, `Falta ${etiqueta}.`);
  return v;
}

/** Texto opcional: vacío se convierte en null, que es lo que esperan los esquemas. */
export const textoOpcional = (fd: FormData, name: string): string | null =>
  crudo(fd, name) || null;

/**
 * Número decimal opcional. Vacío -> null.
 *
 * Acepta coma decimal: en el corral se teclea «8,5» tanto como «8.5», y el
 * `<input type="number">` de un teléfono en configuración regional española
 * envía la coma tal cual. `Number('8,5')` es NaN, así que sin esta línea la
 * medición se perdería o entraría mal.
 */
export function numeroOpcional(fd: FormData, name: string, etiqueta = name): number | null {
  const v = crudo(fd, name);
  if (!v) return null;
  const n = Number(v.replace(',', '.'));
  if (!Number.isFinite(n)) throw new CampoInvalido(name, `${etiqueta}: «${v}» no es un número.`);
  return n;
}

/** Entero obligatorio. */
export function entero(fd: FormData, name: string, etiqueta = name): number {
  const v = crudo(fd, name);
  const n = Number(v);
  if (!v || !Number.isInteger(n)) {
    throw new CampoInvalido(name, `${etiqueta}: se esperaba un número entero.`);
  }
  return n;
}

/**
 * Valor de un conjunto cerrado, o null si viene vacío.
 *
 * Los `<select>` del formulario ya limitan las opciones, pero un POST a mano no.
 * Validar aquí evita mandarle al esquema un valor que Postgres rechazaría con un
 * error de CHECK que el veterinario no puede accionar.
 */
export function opcionDe<T extends string>(
  fd: FormData,
  name: string,
  validos: readonly T[],
  etiqueta = name,
): T | null {
  const v = crudo(fd, name);
  if (!v) return null;
  if (!validos.includes(v as T)) throw new CampoInvalido(name, `${etiqueta}: valor no reconocido.`);
  return v as T;
}

/** Igual que `opcionDe` pero obligatorio. */
export function opcion<T extends string>(
  fd: FormData,
  name: string,
  validos: readonly T[],
  etiqueta = name,
): T {
  const v = opcionDe(fd, name, validos, etiqueta);
  if (!v) throw new CampoInvalido(name, `Falta ${etiqueta}.`);
  return v;
}

/**
 * Mensaje accionable a partir de lo que sea que se lanzó.
 *
 * Un ZodError trae todos los fallos en `issues`; sin desempacarlo el usuario ve
 * el JSON crudo del error. Se muestran los tres primeros: la lista completa de
 * un control de 40 vacas no cabe en un aviso.
 */
export function mensajeDeError(e: unknown): string {
  if (e && typeof e === 'object' && 'issues' in e) {
    const issues = (e as { issues: { path: (string | number)[]; message: string }[] }).issues;
    const partes = issues.slice(0, 3).map((i) => {
      const donde = i.path.filter((p) => typeof p === 'string').join('.');
      return donde ? `${donde}: ${i.message}` : i.message;
    });
    if (issues.length > 3) partes.push(`(+${issues.length - 3} más)`);
    return partes.join(' · ');
  }
  return e instanceof Error ? e.message : String(e);
}
