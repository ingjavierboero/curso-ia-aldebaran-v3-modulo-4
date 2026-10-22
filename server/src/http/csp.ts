/**
 * Content-Security-Policy de la app (RNF-16, research R-16). Las importan el server y la configuración
 * de Vite, para que las políticas existan en un solo lugar. Este archivo no importa nada.
 */

/** API: solo responde JSON, así que no necesita cargar nada. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'";

const webDirectives = (scriptSources: string) =>
  [
    "default-src 'self'",
    `script-src ${scriptSources}`,
    // antd inyecta sus estilos en línea.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "frame-ancestors 'none'",
  ].join('; ');

/** Web compilada (`npm start` y `vite preview`): solo scripts propios (AC-256). */
export const WEB_CSP = webDirectives("'self'");

/**
 * Web en `vite dev`: la misma política más el script inline del preámbulo de React Refresh. Los
 * adjuntos tienen su propia CSP `sandbox` en todos los modos, así que esto no los expone.
 */
export const DEV_WEB_CSP = webDirectives("'self' 'unsafe-inline'");
