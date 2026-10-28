/**
 * Barrido de permisos por perfil (RF-06 a RF-13): todos los perfiles ven los listados, el dashboard, la
 * revisión, los reportes y el historial (los usuarios, solo un Admin); un usuario Consulta no puede
 * modificar nada, salvo enviar un recordatorio manual y cambiar su propia contraseña.
 */
import { describe, expect, it } from 'vitest';
import { exchangeRates, fallbackAlerts, invoices, notices, receivedEmails } from '../../src/db/schema.ts';
import { runBilling } from '../../src/services/billing.ts';
import { recordProcessError } from '../../src/services/process-errors.ts';
import { createTestApp, loggedInAgent, type TestApp } from '../helpers/test-app.ts';
import {
  assignProduct,
  configureIssuer,
  insertClient,
  insertProduct,
  insertUser,
  TEST_PASSWORD,
} from '../helpers/test-db.ts';

const NOW = '2026-10-15T14:00:00.000Z';

/** Sistema con un registro de cada tipo, para que cada endpoint tenga algo que mostrar o modificar. */
async function populated() {
  const t = createTestApp({ now: NOW });
  configureIssuer(t.db);
  const client = insertClient(t.db, { ivaCondition: 6, billingEmail: 'pagos@losandes.com' });
  const product = insertProduct(t.db);
  assignProduct(t.db, client.id, product.id);
  await runBilling(t.ctx, { period: '2026-10', triggeredBy: 'agente_dia_15' });
  const invoice = t.db.select().from(invoices).get()!;
  const email = t.db
    .insert(receivedEmails)
    .values({
      messageId: '<aviso@otro.com>',
      fromAddress: 'otro@desconocido.com',
      fromNormalized: 'otro@desconocido.com',
      subject: 'Consulta',
      bodyText: 'Hola',
      receivedAt: NOW,
      processedAt: NOW,
    })
    .returning()
    .get();
  const notice = t.db.insert(notices).values({ receivedEmailId: email.id, status: 'pendiente' }).returning().get();
  const error = recordProcessError(t.db, {
    operation: 'envio_factura',
    clientId: client.id,
    period: '2026-10',
    invoiceId: invoice.id,
    attempts: 4,
    message: 'Gmail rechazó el envío',
    now: new Date(NOW),
  });
  const rate = t.db
    .insert(exchangeRates)
    .values({ rateCents: 150_000, source: 'dolarhoy.com', readAt: NOW })
    .returning()
    .get();
  t.db.insert(fallbackAlerts).values({ exchangeRateId: rate.id, usedAt: NOW }).run();
  const otherUser = insertUser(t.db, { role: 'editor' });
  return { t, client, product, invoice, notice, error, otherUser };
}

type Scenario = Awaited<ReturnType<typeof populated>>;

/** Pantallas de lectura que ven todos los perfiles (AC-04, AC-07, AC-11). */
const READS = (s: Scenario) => [
  '/api/clients',
  `/api/clients/${s.client.id}`,
  `/api/clients/${s.client.id}/products`,
  `/api/clients/${s.client.id}/history`,
  '/api/products',
  '/api/invoices',
  `/api/invoices/${s.invoice.id}`,
  `/api/invoices/${s.invoice.id}/pdf`,
  '/api/billing/current',
  '/api/dashboard',
  '/api/review/payments',
  '/api/review/notices',
  '/api/review/resolved',
  '/api/review/errors',
  '/api/reports/billing',
  '/api/reports/collections',
  '/api/reports/debt',
  '/api/reports/debt?format=csv',
  '/api/settings',
];

/** Acciones de escritura que un usuario Consulta no puede hacer (AC-217, RF-13), con un cuerpo válido. */
const WRITES = (s: Scenario): Array<[method: 'post' | 'put' | 'patch', url: string, body?: object]> => [
  ['post', '/api/users', { name: 'Nuevo', email: 'nuevo@empresa.com', role: 'editor', password: TEST_PASSWORD }],
  ['patch', `/api/users/${s.otherUser.id}`, { name: 'Otro nombre' }],
  ['post', `/api/users/${s.otherUser.id}/deactivate`],
  ['post', `/api/users/${s.otherUser.id}/reactivate`],
  [
    'post',
    '/api/clients',
    { businessName: 'Nuevo', cuit: '30711111111', address: 'Calle 1', billingEmail: 'n@c.com', ivaCondition: 6 },
  ],
  ['patch', `/api/clients/${s.client.id}`, { businessName: 'Otro nombre' }],
  ['post', `/api/clients/${s.client.id}/deactivate`],
  ['post', `/api/clients/${s.client.id}/reactivate`],
  ['put', `/api/clients/${s.client.id}/products`, { productIds: [] }],
  ['post', '/api/products', { name: 'Nuevo', priceCents: 100, currency: 'ARS' }],
  ['patch', `/api/products/${s.product.id}`, { name: 'Otro nombre' }],
  ['post', `/api/products/${s.product.id}/deactivate`],
  ['post', `/api/products/${s.product.id}/reactivate`],
  ['post', `/api/invoices/${s.invoice.id}/status`, { to: 'pagada', expectedStatus: 'pendiente_de_pago' }],
  ['post', `/api/review/notices/${s.notice.id}/reviewed`],
  ['post', `/api/review/errors/${s.error.id}/retry`],
  ['post', `/api/review/errors/${s.error.id}/resolve`],
  ['post', '/api/dashboard/exchange-rate/confirm'],
  ['post', '/api/billing/current/bill-now'],
  ['post', '/api/billing/current/cancel'],
  ['post', '/api/billing/current/reactivate'],
  ['put', '/api/settings', { retryCount: 5 }],
];

/** Contenido de todas las tablas salvo las sesiones, para saber si algo cambió. */
function snapshot(t: TestApp): string {
  const sqlite = (t.db as unknown as { $client: { prepare(sql: string): { all(): unknown[] } } }).$client;
  const tables = sqlite
    .prepare("select name from sqlite_master where type = 'table' and name not in ('sessions') order by name")
    .all() as Array<{ name: string }>;
  return JSON.stringify(tables.map(({ name }) => [name, sqlite.prepare(`select * from "${name}"`).all()]));
}

describe('lectura por perfil (RF-06, RF-09, RF-11)', () => {
  it.each([
    ['AC-04', 'admin'],
    ['AC-07', 'editor'],
    ['AC-11', 'consulta'],
  ] as const)('%s: un %s ve los listados, el dashboard, la revisión, los reportes y el historial', async (_, role) => {
    const s = await populated();
    const { agent } = await loggedInAgent(s.t, { role });

    for (const url of READS(s)) {
      const res = await agent.get(url);
      expect(res.status, `${role} GET ${url}`).toBe(200);
    }
  });

  it('AC-04: solo un Admin ve el listado de usuarios', async () => {
    const s = await populated();
    for (const role of ['admin', 'editor', 'consulta'] as const) {
      const { agent } = await loggedInAgent(s.t, { role });
      expect((await agent.get('/api/users')).status, role).toBe(role === 'admin' ? 200 : 403);
    }
  });
});

describe('un usuario Consulta no modifica nada (RF-13)', () => {
  it('AC-217: cada acción de escritura se rechaza con 403 y ningún registro cambia', async () => {
    const s = await populated();
    const { agent } = await loggedInAgent(s.t, { role: 'consulta' });
    const before = snapshot(s.t);

    for (const [method, url, body] of WRITES(s)) {
      const res = await agent[method](url).send(body ?? {});
      expect(res.status, `${method.toUpperCase()} ${url}`).toBe(403);
    }

    expect(snapshot(s.t)).toBe(before);
    expect(s.t.adapters.arca.requests).toHaveLength(1); // solo la factura de la corrida
    expect(s.t.adapters.mailSender.attempts).toHaveLength(1); // solo su email
  });

  it('AC-217: un usuario Consulta sí puede cambiar su propia contraseña y enviar un recordatorio manual', async () => {
    const s = await populated();
    const { agent } = await loggedInAgent(s.t, { role: 'consulta' });

    const password = await agent
      .post('/api/auth/password')
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'otra-clave-segura-1' });
    expect(password.status).toBe(204);

    const reminder = await agent.post(`/api/clients/${s.client.id}/reminder`);
    expect(reminder.status).toBe(200);
  });
});
