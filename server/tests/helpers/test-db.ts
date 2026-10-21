/**
 * Base SQLite en memoria con las migraciones aplicadas y builders de datos de prueba.
 * Los builders insertan directo en la base, sin las validaciones de los servicios: así se pueden
 * armar datos heredados o casos que el alta rechazaría (por ejemplo, AC-42, AC-132, AC-141).
 */
import bcrypt from 'bcrypt';
import { type Db, openDatabase } from '../../src/db/client.ts';
import { clientProducts, clients, invoices, products, settings, users } from '../../src/db/schema.ts';

export function createTestDb(): Db {
  return openDatabase(':memory:');
}

const NOW = '2026-10-01T12:00:00.000Z';
let sequence = 0;
const next = () => ++sequence;

/** Contraseña de los usuarios de prueba. */
export const TEST_PASSWORD = 'clave-de-prueba-1';
// Costo bajo solo para que los tests sean rápidos; la app usa costo 12 (RNF-09).
const TEST_PASSWORD_HASH = bcrypt.hashSync(TEST_PASSWORD, 4);

export function insertUser(db: Db, overrides: Partial<typeof users.$inferInsert> = {}) {
  const n = next();
  const email = overrides.email ?? `usuario${n}@empresa.com`;
  return db
    .insert(users)
    .values({
      name: `Usuario ${n}`,
      role: 'admin',
      status: 'activo',
      passwordHash: TEST_PASSWORD_HASH,
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
      email,
      emailNormalized: email.toLowerCase(),
    })
    .returning()
    .get();
}

export function insertClient(db: Db, overrides: Partial<typeof clients.$inferInsert> = {}) {
  const n = next();
  const billingEmail = overrides.billingEmail ?? `cliente${n}@clientes.com`;
  return db
    .insert(clients)
    .values({
      businessName: `Cliente ${n} SA`,
      // CUIT único por cliente de prueba; no siempre tiene dígito verificador válido.
      cuit: `3${String(n).padStart(10, '0')}`,
      address: 'Av. Siempre Viva 742, CABA',
      ivaCondition: 1,
      status: 'activo',
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
      billingEmail,
      billingEmailNormalized: billingEmail.toLowerCase(),
    })
    .returning()
    .get();
}

export function insertProduct(db: Db, overrides: Partial<typeof products.$inferInsert> = {}) {
  const n = next();
  return db
    .insert(products)
    .values({
      name: `Producto ${n}`,
      priceCents: 1_000_000,
      currency: 'ARS',
      status: 'activo',
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    })
    .returning()
    .get();
}

export function assignProduct(db: Db, clientId: number, productId: number) {
  return db.insert(clientProducts).values({ clientId, productId, assignedAt: NOW }).returning().get();
}

/** Factura del período indicado, por defecto Pendiente de pago, emitida el 15 y con vencimiento a fin de mes. */
export function insertInvoice(
  db: Db,
  overrides: Partial<typeof invoices.$inferInsert> & { clientId: number; period: string },
) {
  const [year, month] = overrides.period.split('-').map(Number) as [number, number];
  const lastDay = `${overrides.period}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`;
  return db
    .insert(invoices)
    .values({
      pointOfSale: 1,
      issueDate: `${overrides.period}-15`,
      serviceFrom: `${overrides.period}-01`,
      serviceTo: lastDay,
      dueDate: lastDay,
      totalCents: 1_000_000,
      ivaCondition: 1,
      clientSnapshot: {},
      issuerSnapshot: {},
      status: 'pendiente_de_pago',
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    })
    .returning()
    .get();
}

/** Completa los datos de la empresa emisora y el punto de venta, para poder facturar. */
export function configureIssuer(db: Db, overrides: Partial<typeof settings.$inferInsert> = {}) {
  db.update(settings)
    .set({
      pointOfSale: 3,
      issuerBusinessName: 'Molina Hernando Agustina Maria',
      issuerAddress: 'Calle Falsa 123, CABA',
      issuerIvaCondition: 'Responsable Monotributo',
      issuerGrossIncomeNumber: '901-123456-7',
      issuerActivityStartDate: '2020-01-01',
      ...overrides,
    })
    .run();
}
