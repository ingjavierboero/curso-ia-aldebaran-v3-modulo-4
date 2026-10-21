import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.ts';

export type Db = BetterSQLite3Database<typeof schema>;
export type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** La base o una transacción abierta: los servicios aceptan cualquiera de las dos. */
export type Conn = Db | DbTx;

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Abre la base (la ruta la resuelve config/mode.ts según el modo), aplica las migraciones pendientes
 * y asegura la fila única de configuración con sus valores por defecto. `:memory:` abre una base en
 * memoria, para los tests.
 */
export function openDatabase(path: string): Db {
  const inMemory = path === ':memory:';
  if (!inMemory) mkdirSync(dirname(path), { recursive: true });

  const sqlite = new Database(path);
  if (!inMemory) sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle({ client: sqlite, schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  db.insert(schema.settings).values({ id: 1 }).onConflictDoNothing().run();
  return db;
}
