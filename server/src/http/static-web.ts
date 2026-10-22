import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Express } from 'express';
import { WEB_CSP } from './csp.ts';
import { securityHeaders } from './middleware/security-headers.ts';

/**
 * Sirve la web compilada (`web/dist`) con la CSP estricta, para `npm start` (AC-256). Las rutas de la
 * web que no son archivos devuelven el `index.html`, y el router de la web resuelve la pantalla. Si
 * la web no está compilada no monta nada.
 */
export function serveWeb(app: Express, webDir: string): void {
  const indexHtml = join(webDir, 'index.html');
  if (!existsSync(indexHtml)) return;

  app.use(securityHeaders(WEB_CSP));
  app.use(express.static(webDir, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.sendFile(indexHtml);
  });
}
