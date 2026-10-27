import express, { type Router } from 'express';
import type { AppContext } from './context.ts';
import { API_CSP } from './http/csp.ts';
import { apiNotFound, errorHandler } from './http/middleware/errors.ts';
import { securityHeaders } from './http/middleware/security-headers.ts';
import { requireSession } from './http/middleware/session.ts';
import { authRouter } from './http/routes/auth.ts';
import { clientsRouter } from './http/routes/clients.ts';
import { productsRouter } from './http/routes/products.ts';
import { settingsRouter } from './http/routes/settings.ts';
import { setupRouter } from './http/routes/setup.ts';
import { usersRouter } from './http/routes/users.ts';
import { serveWeb } from './http/static-web.ts';

/** Arma un router de la API a partir del contexto; cada historia agrega los suyos. */
export type RouterFactory = (ctx: AppContext) => Router;

/** Routers de la API, en el orden en que se montan bajo `/api`. Cada historia suma acá el suyo. */
const apiRouters: RouterFactory[] = [setupRouter, authRouter, usersRouter, settingsRouter, clientsRouter, productsRouter];

export interface AppOptions {
  routers?: RouterFactory[];
  log?: (message: string) => void;
  /** Directorio de la web compilada; si existe, Express la sirve después de la API (`npm start`). */
  webDir?: string;
}

export function createApp(ctx: AppContext, options: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Los adjuntos de la casilla simulada viajan en base64 dentro del JSON (RF-200).
  app.use(express.json({ limit: '30mb' }));
  // Headers de seguridad en toda respuesta de la API, también en los errores (RNF-16).
  app.use('/api', securityHeaders(API_CSP));
  // Toda la API exige sesión salvo los endpoints públicos (RF-01).
  app.use('/api', requireSession(ctx));

  for (const factory of options.routers ?? apiRouters) app.use('/api', factory(ctx));
  app.use('/api', apiNotFound);
  if (options.webDir) serveWeb(app, options.webDir);
  app.use(errorHandler(options.log));
  return app;
}
