# Constitución de finca-bot (Ganadería Bovina Doble Propósito)

Esta constitución gobierna toda especificación, plan y tarea del proyecto. Se escribió en español
porque es el idioma del dueño del producto y de los usuarios; los identificadores de dominio siguen
la convención del proyecto (ver principio XIV).

## Core Principles

### I. Capa de dominio única

- Toda escritura a una tabla de datos MUST pasar por `src/lib/domain/`. Ningún canal (WhatsApp,
  tablero web, importaciones, sensores, IA, n8n) escribe directo con `supabase.from(...)`.
- Las funciones de dominio validan con zod, escriben y devuelven lo que el canal necesita mostrar.
- Los esquemas de `src/lib/domain/schemas.ts` MUST reflejar los CHECK de la base; se cambian juntos,
  en la misma especificación.

Razón: los valores derivados (por ejemplo, el retiro de leche) calculados en dos lugares terminan
divergiendo, y el fallo es leche contaminada en la cantina.

### II. Trazabilidad total

- Toda creación, modificación y anulación MUST registrar quién la hizo, cuándo, por qué canal
  (WhatsApp o web), con qué fuente, y el valor anterior y el nuevo.
- La identidad del autor MUST salir de la sesión (web) o del teléfono autorizado (WhatsApp), nunca
  de un campo que el usuario pueda escribir.
- Los datos del hato MUST NOT borrarse físicamente: se anulan con un motivo obligatorio. Un registro
  anulado sale de los cálculos y permanece en la bitácora.
- Solo el rol `propietario` MAY anular. Corregir un registro deja guardada la versión anterior.

Razón: el propietario necesita saber quién registró, cambió o quitó cada dato del hato.

### III. Nada se crea por accidente

- Ningún canal MAY crear un animal de forma implícita a partir de un identificador desconocido.
- Solo el `propietario` MAY ingresar animales que llegan de afuera (compra u otra procedencia).
- Los animales nacidos en la finca se crean automáticamente al registrar el parto.
- Un identificador desconocido (número de manejo o RFID) MUST quedar pendiente de revisión del
  propietario; nunca genera un animal fantasma.

### IV. Captura de menor fricción

- El sistema MUST proponer lo que toca y la persona confirma, en lugar de depender de la memoria.
- Cada especificación MUST explicar cómo reduce lo que hay que escribir o recordar en campo.
- Todo registro MUST poder hacerse por WhatsApp y por la web, salvo que la especificación justifique
  por qué un canal no aplica.

### V. Toda fuente queda registrada

- Cada dato MUST guardar su fuente: `manual`, `voz`, `sensor`, `importado`, `deducido` o
  `carga_inicial` (la lista puede crecer por especificación).
- Los sensores MUST entrar por la misma capa de dominio que el registro manual.
- Las lecturas crudas de sensores MUST guardarse aparte de los eventos que se derivan de ellas.
- Una fecha aproximada MUST marcarse como aproximada; nunca se presenta como exacta.

### VI. Multi-finca desde el día uno

- Todo INSERT MUST nombrar `finca_id` explícitamente (`src/lib/tenant.ts`); no se depende del
  DEFAULT de la columna.
- Toda lectura MUST filtrar por `finca_id`. Mientras el RLS siga dormido bajo `service_role`, ese
  filtro es el aislamiento real.
- Los identificadores de animal MUST ser únicos por finca, no en todo el sistema.
- Las vistas nuevas MUST llevar `security_invoker = true`.

### VII. Fechas de la finca

- Toda fecha de calendario MUST salir de `src/lib/dates.ts`; nunca de `new Date().toISOString()`.
- Los instantes se guardan en UTC y se muestran con `horaEnFinca()` / `selloEnFinca()`.
- Las fechas derivadas MUST calcularse desde la fecha del evento, no desde hoy.
- No se aceptan fechas futuras en eventos ya ocurridos.

### VIII. Cada regla en un solo lugar

- Un cálculo de negocio MUST vivir en una sola función o vista; duplicarlo es un defecto.
- Todo producto aplicado MUST pasar por `sanidad.aplicarProducto()`, único lugar donde se deriva
  `retiro_leche_hasta`.

### IX. Lecturas honestas

- Una consulta fallida MUST NOT mostrarse como cero, lista vacía ni "no encontrado": se muestra «—»
  o un aviso. Toda lectura pasa por `unwrapList()` o maneja el error de forma explícita.
- Toda lectura que se agrega MUST pasar por `paginar()` o agregarse en SQL; cortar en silencio en el
  límite de filas está prohibido.
- Los procesos automáticos (alertas, respaldos) MUST abortar o avisar antes que reportar algo falso.

### X. Autorización en cada punto

- Cada página y cada acción del servidor MUST verificar el permiso con `requerirPermiso()`. Ocultar
  un enlace no es autorización.
- El bot de WhatsApp MUST aplicar la misma matriz de permisos que el tablero.

### XI. Pruebas que no mienten

- Cada regla de negocio nueva MUST tener al menos una prueba que falle si la regla se rompe.
- El Supabase falso de las pruebas MUST imponer los mismos únicos y el mismo límite de filas que
  producción; cuando la base gana un único, el falso también.
- Las pruebas MUST verificar `finca_id` en cada fila escrita y el aislamiento entre fincas.
- Ninguna tarea se da por terminada con la suite en rojo.

### XII. La IA consulta, no escribe

- La IA MUST llamar funciones tipadas donde el código, no el modelo, fija `finca_id`.
- Si una petición implica registrar algo, MUST enrutarse al flujo existente para que una persona
  confirme; la IA nunca escribe directo en la base.
- El banco de evaluación MUST existir antes del primer prompt en producción, con casos de respuesta
  exacta, rechazo, identificador ambiguo y aislamiento entre fincas.

### XIII. Base de datos con aprobación

- El SQL MUST ser idempotente. El SQL ya aplicado no se reescribe: cada cambio es un archivo nuevo
  numerado en `db/`, con su orden de aplicación documentado.
- Ningún SQL MAY aplicarse a producción, ni crearse o activarse un workflow de n8n, sin aprobación
  explícita de Johan.
- Los scripts destructivos se entregan desactivados, con un ensayo en `begin … rollback`, y se hace
  respaldo antes de correrlos.
- Un cambio de esquema que exija migrar datos MUST incluir el orden de despliegue (datos antes que
  código, o al revés) en su plan.

### XIV. Idioma y términos

- Tablas, columnas, identificadores de dominio y textos visibles en español; código, nombres de
  funciones y comentarios en inglés.
- Términos colombianos: potrero, arete, ordeño, mayordomo, vaquero. Moneda: COP.
- Los mensajes del bot van sin markdown, con separadores `━━━` y botones o listas interactivas.

### XV. Lo que cambia entre fincas es configuración, no código

- Frecuencias, plazos, metas, reportes, tipos de novedad y planes (por ejemplo, el vacunal) MUST
  guardarse por finca y editarse desde la aplicación.
- Ninguna regla de negocio nueva MAY llevar esos números escritos en el código: los lee de la
  configuración de la finca, con valores por defecto documentados. Los números fijos que ya existen
  se migran en la especificación de configuración.
- Cambiar la configuración MUST recalcular lo que depende de ella y quedar en la bitácora.
- Solo `propietario` y `admin` MAY cambiar la configuración.

## Restricciones técnicas

- Stack: Next.js 15 (App Router) + React 19 + TypeScript, Tailwind v4, zod, Supabase (Postgres),
  Supabase Auth, Meta WhatsApp Cloud API, Vitest. Despliegue en Docker sobre Easypanel desde `main`.
  Un cambio de stack MUST justificarse en el plan.
- La aplicación es la única fuente de verdad y el único receptor de WhatsApp. No se agrega lógica de
  negocio nueva en n8n.
- Secretos solo en variables de entorno de Easypanel. `.env.local` nunca se lee al contexto, se
  imprime ni se sube. Solo `.env.example` está versionado.
- Las fuentes tipográficas son del sistema o van dentro del proyecto: el build no depende de red.
- Los formularios del tablero funcionan sin JavaScript de cliente salvo excepción justificada,
  porque se llenan en el corral con mala señal.

## Flujo de trabajo

- Todo cambio funcional sigue el ciclo de Spec Kit: `/speckit-specify` → `/speckit-clarify` →
  `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`. Las correcciones menores y documentales
  pueden ir sin especificación.
- Cada especificación describe el cambio que se va a hacer, no todo el sistema existente.
- Cada plan MUST pasar el "Constitution Check": cualquier violación se justifica en la tabla de
  complejidad o el plan se rehace.
- Johan revisa y aprueba el SQL y los cambios importantes antes de aplicarlos. Se itera en local y
  se sube al repositorio cuando lo construido está definido.
- `CLAUDE.md` se mantiene como contexto técnico; no se modifica sin que Johan lo pida, y no puede
  contradecir esta constitución.

## Governance

- Esta constitución prevalece sobre cualquier especificación, plan, tarea o `CLAUDE.md`.
- Enmendarla requiere aprobación explícita de Johan, una nota de qué cambió y por qué, y el plan de
  migración si la enmienda obliga a cambiar código existente.
- Versionado semántico: MAJOR al quitar o redefinir un principio; MINOR al agregar un principio o
  sección, o ampliarlo de forma material; PATCH para aclaraciones y redacción.
- Toda revisión de una especificación o de un cambio MUST verificar el cumplimiento de estos
  principios.

**Version**: 1.0.0 | **Ratified**: 2026-10-11 | **Last Amended**: 2026-10-11
