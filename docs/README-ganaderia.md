# Sistema de Gestión Ganadera Doble Propósito (GDP)

Bot de WhatsApp con IA para registrar y consultar todo el manejo de un hato bovino
de doble propósito (reproducción, producción de leche, sanidad, peso y genealogía),
con trazabilidad total e historial por animal.

> **Aislado de "Granja El Redil":** prefijo `GDP ·`, base de datos propia, número de
> WhatsApp dedicado y ruta de webhook `gdp-whatsapp`. Los dos sistemas nunca se cruzan.

## Stack
- **WhatsApp:** Meta Cloud API (número nuevo).
- **IA:** OpenAI (parser de intención + Whisper para notas de voz).
- **Base de datos:** Supabase (proyecto nuevo).
- **Orquestación:** n8n (self-hosted).

## Artefactos

### Base de datos (`db/`) — ejecutar en este orden en el SQL Editor de Supabase
1. [schema.sql](../db/schema.sql) — 7 tablas + vista `vw_historial_animal`.
2. [alerts_views.sql](../db/alerts_views.sql) — vista `vw_alertas` (partos, secados, celos, preñez, sanidad).
3. [backup.sql](../db/backup.sql) — tabla `respaldos` + vista `vw_respaldo_completo`.

### Workflows (`workflows/`) — validados con n8n-mcp
| Workflow | Función |
|---|---|
| [GDP-WF-00](../workflows/GDP-WF-00-verificacion-meta.json) | Verificación del webhook de Meta (valida el verify_token). |
| [GDP-WF-01](../workflows/GDP-WF-01-receptor.json) | Receptor: texto+voz → IA → **confirmar antes de guardar** → registrar/consultar. |
| [GDP-WF-02](../workflows/GDP-WF-02-alertas-dashboard.json) | Resumen diario de alertas por WhatsApp (cron 06:00). |
| [GDP-WF-03](../workflows/GDP-WF-03-backup-diario.json) | Snapshot diario del hato (cron 02:00). |

## Placeholders a reemplazar al desplegar
- `SUPABASE_PROJECT` → subdominio de tu proyecto Supabase.
- `META_PHONE_NUMBER_ID` → Phone Number ID del número nuevo.
- `CHANGE_ME_GDP_VERIFY_TOKEN` (WF-00) → el verify token que definas en Meta.
- `PRODUCTOR_WA_ID` (WF-02) → número del productor que recibe el resumen.

## Credenciales n8n a crear
- `supabaseApi` → host + service_role key del proyecto nuevo.
- `openAiApi` → API key de OpenAI.
- `httpHeaderAuth` (Meta) → header `Authorization` = `Bearer <token de Meta>`.

## Puesta en marcha
1. Crear el proyecto Supabase y ejecutar los 3 SQL en orden.
2. Crear las 3 credenciales en n8n.
3. Importar los 4 workflows, reemplazar placeholders y enlazar credenciales.
4. Configurar el webhook en Meta apuntando a la URL de n8n (`/webhook/gdp-whatsapp`)
   con el verify token; suscribir el campo `messages`.
5. **Probar en vivo** (mensaje de texto y nota de voz) con WF-01 desactivado→activado.
6. Activar WF-02 y WF-03.
