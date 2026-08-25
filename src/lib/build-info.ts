// Identidad de la imagen que está corriendo. Sirve para una sola pregunta, la
// que se repite en cada despliegue: ¿el contenedor de allá arriba ya trae mi
// último commit, o sigue el viejo?
//
// ⚠️ ESTE ARCHIVO SE REESCRIBE EN EL BUILD DE DOCKER (ver Dockerfile, etapa
// builder). Lo que está aquí son los valores de desarrollo local; en producción
// nunca se leen. Si cambias la forma del objeto, cambia también el `printf` del
// Dockerfile — quedan en dos sitios porque el build no puede importar TypeScript
// antes de compilarlo.
//
// El SHA llega por `--build-arg GIT_SHA=...` y queda en 'desconocido' si nadie
// lo pasa. La marca de tiempo NO depende de esa configuración: la genera el
// propio build, así que responde la pregunta aunque el GIT_SHA nunca se ajuste.

export const BUILD_INFO = {
  sha: 'dev',
  construidoEn: 'dev',
} as const;
