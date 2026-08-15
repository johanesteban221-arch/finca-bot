# Despliegue de finca-bot en Easypanel

Bot de WhatsApp (Next.js 15, salida standalone) desplegado como app Docker en el
mismo Easypanel donde corre n8n.

## 1. Repo en GitHub
El código vive en un repo de GitHub. Easypanel se conecta a él y construye con el `Dockerfile`.

## 2. Crear la app en Easypanel
1. Easypanel → tu proyecto → **+ Service → App**.
2. Nombre: `finca-bot`.
3. **Source → GitHub**: elige el repo `finca-bot`, rama `main`.
4. **Build → Dockerfile** (Easypanel detecta el `Dockerfile` en la raíz).

## 3. Variables de entorno (Environment)
Pega estas en la pestaña **Environment** de la app (valores reales, NO los placeholders):

```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_ANON_KEY=...          # clave anon/publishable — solo para el login del tablero
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_TOKEN=...
WHATSAPP_VERIFY_TOKEN=...
CRON_SECRET=...
AUTH_LEGACY_BASIC=1            # puerta de arranque, ver §8
DASHBOARD_USER=...
DASHBOARD_PASSWORD=...
```

## 4. Puerto y dominio
- **Port**: `3000` (el contenedor expone 3000).
- **Domains**: añade un dominio. Con el subdominio gratis queda algo como
  `johan-finca-bot.qfdh9u.easypanel.host` con HTTPS automático.

## 5. Deploy
Pulsa **Deploy**. Easypanel construye la imagen y levanta el contenedor.
Verifica en `https://<tu-dominio>/` que responde "🐄 Finca Bot".

## 6. Webhook en Meta
En la app de Meta (Ganaderia) → WhatsApp → Configuración → **Webhooks**:
- **Callback URL**: `https://<tu-dominio>/api/whatsapp/webhook`
- **Verify token**: el mismo valor de `WHATSAPP_VERIFY_TOKEN`.
- Suscribe el campo **messages**.

## 7. Actualizaciones
`git push` a `main` → Easypanel redepliega (si activaste auto-deploy) o pulsa **Deploy**.

## 8. Primer ingreso al tablero con usuarios y roles (Fase 2)
El tablero entra con correo y contraseña (Supabase Auth). El primer dueño no
puede crearse a sí mismo, así que hay una puerta de arranque. **En este orden:**

1. Aplica `db/04_auth_roles.sql` en el SQL Editor de Supabase.
2. Deja `AUTH_LEGACY_BASIC=1` y entra a `/dashboard` con el usuario y contraseña
   de siempre. Esa sesión actúa como **dueño** y muestra un aviso amarillo.
3. Ve a **Usuarios → Agregar usuario**, créate con rol **Dueño**. La pantalla
   muestra una contraseña temporal **una sola vez**: cópiala.
4. Abre `/login` en otro navegador (o ventana privada) y comprueba que entras
   con ese correo y esa contraseña.
5. Solo entonces borra `AUTH_LEGACY_BASIC` de Environment y redepliega.

⚠️ Si borras `AUTH_LEGACY_BASIC` antes del paso 4 y el login nuevo falla, te
quedas fuera de tu propia finca: habría que volver a ponerlo en Easypanel.
Mientras la variable esté en `1`, el tablero sigue funcionando aunque
`SUPABASE_ANON_KEY` falte o esté mal — el Basic Auth no depende de ella.
