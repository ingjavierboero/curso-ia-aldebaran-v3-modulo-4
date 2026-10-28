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

/** Datos obligatorios para facturar (RF-73, RF-91), en el orden en que se nombran; el de fantasía es opcional. */
const REQUIRED_FOR_BILLING: Array<[keyof Settings, string]> = [
  ['pointOfSale', 'punto de venta'],
  ['issuerBusinessName', 'razón social'],
  ['issuerAddress', 'domicilio comercial'],
  ['issuerIvaCondition', 'condición frente al IVA'],
  ['issuerGrossIncomeNumber', 'número de ingresos brutos'],
  ['issuerActivityStartDate', 'fecha de inicio de actividades'],
];

/** Datos obligatorios de la empresa emisora y el punto de venta que faltan para facturar (RF-219, RF-221). */
export function missingForBilling(s: Settings): string[] {
  return REQUIRED_FOR_BILLING.filter(([field]) => !s[field]).map(([, label]) => label);
}
