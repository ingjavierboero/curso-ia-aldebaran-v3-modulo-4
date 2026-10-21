import type { Adapters } from './adapters/types.ts';
import type { Env } from './config/env.ts';
import type { Db } from './db/client.ts';

/** Dependencias que reciben los servicios y los routers de la API. */
export interface AppContext {
  db: Db;
  env: Env;
  adapters: Adapters;
}
