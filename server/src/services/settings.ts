import { eq } from 'drizzle-orm';
import type { Conn } from '../db/client.ts';
import { settings } from '../db/schema.ts';

export type Settings = Omit<typeof settings.$inferSelect, 'id'>;
export type SettingsChanges = Partial<Settings>;

/** La configuración es una fila única (id = 1) que se crea al abrir la base con los valores por defecto. */
const SETTINGS_ID = 1;

export function getSettings(conn: Conn): Settings {
  const row = conn.select().from(settings).where(eq(settings.id, SETTINGS_ID)).get();
  if (!row) throw new Error('Falta la fila de configuración: la base no se abrió con openDatabase.');
  const { id: _id, ...values } = row;
  return values;
}

/** Guarda solo los valores indicados; los rangos se validan antes, en la API. */
export function updateSettings(conn: Conn, changes: SettingsChanges): Settings {
  if (Object.keys(changes).length > 0) {
    conn.update(settings).set(changes).where(eq(settings.id, SETTINGS_ID)).run();
  }
  return getSettings(conn);
}
