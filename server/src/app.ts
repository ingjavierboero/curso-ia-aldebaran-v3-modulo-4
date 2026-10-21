import express, { type Router } from 'express';
import type { AppContext } from './context.ts';
import { apiNotFound, errorHandler } from './http/middleware/errors.ts';

/** Arma un router de la API a partir del contexto; cada historia agrega los suyos. */
export type RouterFactory = (ctx: AppContext) => Router;

/** Routers de la API, en el orden en que se montan bajo `/api`. Cada historia suma acá el suyo. */
const apiRouters: RouterFactory[] = [];

export interface AppOptions {
  routers?: RouterFactory[];
  log?: (message: string) => void;
}

export function createApp(ctx: AppContext, options: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Los adjuntos de la casilla simulada viajan en base64 dentro del JSON (RF-200).
  app.use(express.json({ limit: '30mb' }));

  for (const factory of options.routers ?? apiRouters) app.use('/api', factory(ctx));
  app.use('/api', apiNotFound);
  app.use(errorHandler(options.log));
  return app;
}
