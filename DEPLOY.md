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
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_TOKEN=...
WHATSAPP_VERIFY_TOKEN=...
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
