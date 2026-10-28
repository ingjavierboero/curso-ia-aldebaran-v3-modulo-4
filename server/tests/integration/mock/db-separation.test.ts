/**
 * Separación de las bases por modo (RF-211 a RF-213), con archivos SQLite reales en una raíz de repo
 * temporal: lo que se crea en un modo no aparece en el otro y la base del modo mock nunca se usa fuera
 * de él. Cada "arranque" resuelve la configuración y abre la base como `index.ts`.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EnvError, loadEnv } from '../../../src/config/env.ts';
import { DatabasePathError } from '../../../src/config/mode.ts';
import { type Db, openDatabase } from '../../../src/db/client.ts';
import { clients, invoices } from '../../../src/db/schema.ts';
import { insertClient, insertInvoice } from '../../helpers/test-db.ts';

/** Variables obligatorias fuera del modo mock, con valores de prueba. */
const REAL_ENV = {
  ANTHROPIC_API_KEY: 'valor-de-prueba-anthropic',
  GMAIL_USER: 'sistema@empresa.com',
  GMAIL_APP_PASSWORD: 'valor-de-prueba-gmail',
  ARCA_CUIT: '30711111111',
  ARCA_CERT_PATH: 'certs/test.crt',
  ARCA_KEY_PATH: 'certs/test.key',
};

let root: string;
const mockDbPath = () => join(root, 'data', 'aldebaran-mock.db');
const realDbPath = () => join(root, 'data', 'aldebaran.db');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aldebaran-modos-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Arranca con esas variables, ejecuta `work` sobre la base que corresponde al modo y la cierra. */
function withStartup<T>(raw: Record<string, string>, work: (db: Db) => T): T {
  const env = loadEnv(raw, root);
  const db = openDatabase(env.databasePath);
  try {
    return work(db);
  } finally {
    // drizzle() devuelve la conexión en $client aunque el tipo Db no la declare.
    (db as Db & { $client: { close(): void } }).$client.close();
  }
}

/** Crea un cliente con una factura y devuelve el CUIT del cliente. */
function createClientWithInvoice(db: Db, cuit: string) {
  const client = insertClient(db, { cuit, businessName: `Cliente ${cuit}` });
  insertInvoice(db, { clientId: client.id, period: '2026-10' });
  return cuit;
}

const cuitsIn = (db: Db) => db.select({ cuit: clients.cuit }).from(clients).all().map((row) => row.cuit);
const invoiceCount = (db: Db) => db.select().from(invoices).all().length;

/** Huella del contenido de una base (archivo principal y WAL), para saber si cambió. */
function fingerprint(path: string): string {
  const hash = createHash('sha256');
  for (const file of [path, `${path}-wal`]) hash.update(existsSync(file) ? readFileSync(file) : 'sin archivo');
  return hash.digest('hex');
}

describe('separación de las bases del modo mock y del modo real (RF-211 a RF-213)', () => {
  it('AC-208: un cliente y una factura creados en modo mock no aparecen al reiniciar fuera del modo mock', () => {
    withStartup({ MOCK_MODE: 'true' }, (db) => createClientWithInvoice(db, '30711111111'));

    withStartup(REAL_ENV, (db) => {
      expect(cuitsIn(db)).toEqual([]);
      expect(invoiceCount(db)).toBe(0);
    });
    withStartup({ MOCK_MODE: 'true' }, (db) => expect(cuitsIn(db)).toEqual(['30711111111']));
  });

  it('AC-208: un cliente y una factura creados fuera del modo mock no aparecen al reiniciar en modo mock', () => {
    withStartup(REAL_ENV, (db) => createClientWithInvoice(db, '20111111112'));

    withStartup({ MOCK_MODE: 'true' }, (db) => {
      expect(cuitsIn(db)).toEqual([]);
      expect(invoiceCount(db)).toBe(0);
    });
    withStartup(REAL_ENV, (db) => expect(cuitsIn(db)).toEqual(['20111111112']));
  });

  it('AC-209: con MOCK_MODE=true y DATABASE_PATH a la base real, el cliente queda en la base mock y la real no cambia', () => {
    withStartup({ ...REAL_ENV, DATABASE_PATH: 'data/aldebaran.db' }, (db) =>
      createClientWithInvoice(db, '20111111112'),
    );
    const before = fingerprint(realDbPath());

    withStartup({ MOCK_MODE: 'true', DATABASE_PATH: 'data/aldebaran.db' }, (db) =>
      createClientWithInvoice(db, '30711111111'),
    );

    expect(fingerprint(realDbPath())).toBe(before);
    expect(existsSync(mockDbPath())).toBe(true);
    withStartup({ MOCK_MODE: 'true' }, (db) => expect(cuitsIn(db)).toEqual(['30711111111']));
    withStartup(REAL_ENV, (db) => expect(cuitsIn(db)).toEqual(['20111111112']));
  });

  it('AC-210: sin MOCK_MODE y con DATABASE_PATH a la base mock, no arranca, informa el error y la base mock no cambia', () => {
    withStartup({ MOCK_MODE: 'true' }, (db) => createClientWithInvoice(db, '30711111111'));
    const before = fingerprint(mockDbPath());

    let error: unknown;
    try {
      withStartup({ ...REAL_ENV, DATABASE_PATH: 'data/aldebaran-mock.db' }, () => {
        throw new Error('no debería haber abierto ninguna base');
      });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(DatabasePathError);
    expect((error as Error).message).toMatch(/DATABASE_PATH.*modo mock/);
    expect(error).not.toBeInstanceOf(EnvError);
    expect(fingerprint(mockDbPath())).toBe(before);
    expect(existsSync(realDbPath())).toBe(false);
  });
});
