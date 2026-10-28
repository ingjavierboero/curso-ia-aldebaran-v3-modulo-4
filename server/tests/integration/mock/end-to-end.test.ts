/**
 * Recorrido de punta a punta del modo mock con sus adapters reales (createAdapters con MOCK_MODE=true):
 * ARCA, el LLM y el email simulados. La cotización, la única conexión externa del modo mock, se reemplaza
 * por un fake para que el test no salga a internet (AGENTS.md).
 */
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdapters } from '../../../src/adapters/index.ts';
import { createMockMail } from '../../../src/adapters/mail/mock-mailbox.ts';
import { loadEnv } from '../../../src/config/env.ts';
import type { AppContext } from '../../../src/context.ts';
import type { Db } from '../../../src/db/client.ts';
import {
  clientEvents,
  invoices,
  invoiceStatusChanges,
  receivedAttachments,
  receivedEmails,
} from '../../../src/db/schema.ts';
import { createBillingJob } from '../../../src/jobs/billing-job.ts';
import { createMailboxJob } from '../../../src/jobs/mailbox-job.ts';
import { createScheduler } from '../../../src/jobs/scheduler.ts';
import { FakeFx, fixedClock } from '../../helpers/fakes.ts';
import {
  assignProduct,
  configureIssuer,
  createTestDb,
  insertClient,
  insertInvoice,
  insertProduct,
} from '../../helpers/test-db.ts';

// Cualquier intento de conectarse a Gmail falla el test: el modo mock no usa SMTP ni IMAP (RF-194).
const gmail = vi.hoisted(() => ({ smtp: vi.fn(), imap: vi.fn() }));
vi.mock('nodemailer', () => ({
  default: { createTransport: gmail.smtp },
  createTransport: gmail.smtp,
}));
vi.mock('imapflow', () => ({ ImapFlow: gmail.imap }));

/** Argentina es UTC-3 todo el año: las 11:00 de Argentina son las 14:00 UTC. */
const utc = (iso: string) => `${iso}:00.000Z`;

const PDF = new Uint8Array([...'%PDF-1.4 comprobante'].map((c) => c.charCodeAt(0)));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const contentFor = (filename: string) =>
  filename.toLowerCase().endsWith('.png') ? PNG : /\.jpe?g$/i.test(filename) ? JPEG : PDF;
const mimeFor = (filename: string) =>
  filename.toLowerCase().endsWith('.png')
    ? 'image/png'
    : /\.jpe?g$/i.test(filename)
      ? 'image/jpeg'
      : 'application/pdf';

/**
 * Sistema armado como en `index.ts` con MOCK_MODE como única variable, sobre una base en memoria (la
 * separación de bases la cubre db-separation.test.ts), con el agente de facturación y el de la casilla.
 */
function setup(start: string) {
  const env = loadEnv({ MOCK_MODE: 'true' });
  const db: Db = createTestDb();
  const clock = fixedClock(start);
  const fx = new FakeFx();
  const adapters = { ...createAdapters(env, db, clock), fx };
  const ctx: AppContext = { db, env, adapters };
  const scheduler = createScheduler({
    enabled: env.schedulerEnabled,
    clock,
    processes: [createBillingJob(ctx), createMailboxJob(ctx)],
    schedule: vi.fn(),
  });
  const { addReceived } = createMockMail(db, clock);
  /** Mueve el reloj y ejecuta el tick de ese minuto. */
  const tickAt = async (iso: string) => {
    clock.set(iso);
    await scheduler.tick();
  };
  /** Carga en la casilla simulada un email recibido con un adjunto (RF-200). */
  const receive = (from: string, filename: string) =>
    addReceived({
      from,
      subject: 'Pago de la factura',
      body: 'Adjunto el comprobante.',
      attachments: [{ filename, mimeType: mimeFor(filename), content: contentFor(filename) }],
    });
  return { env, db, clock, fx, scheduler, tickAt, receive };
}

/** Cliente con CUIT válido, una única factura emitida en Pendiente de pago y la casilla ya revisada una vez. */
async function clientWithDebt(totalCents = 1_500_050) {
  const s = setup(utc('2026-10-20T13:00'));
  const client = insertClient(s.db, { cuit: '30711111111', billingEmail: 'pagos@losandes.com' });
  const invoice = insertInvoice(s.db, {
    clientId: client.id,
    period: '2026-10',
    number: 1,
    cae: '71234567890123',
    totalCents,
  });
  await s.tickAt(utc('2026-10-20T13:00')); // primera revisión de la casilla, sin emails
  return { ...s, client, invoice };
}

const statusOf = (db: Db, id: number) => db.select().from(invoices).where(eq(invoices.id, id)).get();

describe('evaluación de punta a punta en modo mock (US9)', () => {
  const fetchSpy = vi.fn(() => Promise.reject(new Error('el modo mock no debe conectarse a internet')));
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockClear();
    gmail.smtp.mockClear();
    gmail.imap.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  /** Ni ARCA (SOAP por fetch), ni la API de Claude (fetch), ni Gmail (SMTP e IMAP). */
  const expectNoExternalCalls = () => {
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(gmail.smtp).not.toHaveBeenCalled();
    expect(gmail.imap).not.toHaveBeenCalled();
  };

  it('AC-204: con MOCK_MODE como única variable arranca, factura el día 15 y procesa la casilla simulada', async () => {
    const s = setup(utc('2026-10-15T13:00'));
    expect(s.env).toMatchObject({ mode: 'mock', schedulerEnabled: true, arcaCuit: '20111111112' });
    configureIssuer(s.db);
    const client = insertClient(s.db, { cuit: '30711111111', billingEmail: 'pagos@losandes.com' });
    assignProduct(s.db, client.id, insertProduct(s.db, { priceCents: 1_500_050 }).id);

    await s.tickAt(utc('2026-10-15T14:00')); // 11:00 en Argentina
    const [invoice] = s.db.select().from(invoices).all();
    expect(invoice).toMatchObject({ status: 'pendiente_de_pago', totalCents: 1_500_050 });

    await s.tickAt(utc('2026-10-15T14:05')); // primera revisión de la casilla, después de emitir
    s.receive('pagos@losandes.com', 'pago_30711111111_15000.50.pdf');
    await s.tickAt(utc('2026-10-15T14:20')); // siguiente revisión, 15 minutos después

    expect(statusOf(s.db, invoice!.id)?.status).toBe('pago_recibido');
    expectNoExternalCalls();
  });

  it('AC-196: sin llamar a ARCA, dos facturas del punto de venta 3 tienen los números 1 y 2 y un CAE que vence a los 10 días', async () => {
    const s = setup(utc('2026-10-15T13:00'));
    configureIssuer(s.db, { pointOfSale: 3 });
    const product = insertProduct(s.db);
    assignProduct(s.db, insertClient(s.db).id, product.id);
    assignProduct(s.db, insertClient(s.db).id, product.id);

    await s.tickAt(utc('2026-10-15T14:00'));

    const issued = s.db.select().from(invoices).all();
    expect(issued.map((i) => [i.pointOfSale, i.number]).sort()).toEqual([
      [3, 1],
      [3, 2],
    ]);
    for (const invoice of issued) {
      expect(invoice.status).toBe('pendiente_de_pago');
      expect(invoice.cae).toMatch(/^\d{14}$/);
      expect(invoice.issueDate).toBe('2026-10-15');
      expect(invoice.caeDueDate).toBe('2026-10-25');
    }
    expectNoExternalCalls();
  });

  it('AC-197: sin llamar a Claude, pago_30711111111_15000.50.pdf se clasifica "si" y la factura pasa a Pago recibido', async () => {
    const s = await clientWithDebt();
    s.receive('pagos@losandes.com', 'pago_30711111111_15000.50.pdf');
    await s.tickAt(utc('2026-10-20T13:15'));

    expect(s.db.select().from(receivedAttachments).all()).toEqual([
      expect.objectContaining({
        filename: 'pago_30711111111_15000.50.pdf',
        classification: 'si',
        extractedCuit: '30711111111',
        extractedAmountCents: 1_500_050,
      }),
    ]);
    expect(statusOf(s.db, s.invoice.id)?.status).toBe('pago_recibido');
    expectNoExternalCalls();
  });

  it.each(['PAGO_x_15000.50.PDF', 'pago_30711111111_x.png'])(
    'AC-198: con el adjunto %s la factura pasa a Revisión manual porque no se pudieron extraer el CUIT o el monto',
    async (filename) => {
      const s = await clientWithDebt();
      s.receive('pagos@losandes.com', filename);
      await s.tickAt(utc('2026-10-20T13:15'));

      expect(statusOf(s.db, s.invoice.id)).toMatchObject({
        status: 'revision_manual',
        manualReviewReason: 'no se pudieron extraer el CUIT o el monto',
      });
      expectNoExternalCalls();
    },
  );

  it.each([
    ['dudoso_transferencia.jpg', 'clasificación dudosa'],
    ['error_1.pdf', 'no se pudo procesar el comprobante'],
  ])('AC-199: con el adjunto %s la factura pasa a Revisión manual con el motivo "%s"', async (filename, reason) => {
    const s = await clientWithDebt();
    s.receive('pagos@losandes.com', filename);
    await s.tickAt(utc('2026-10-20T13:15'));

    expect(statusOf(s.db, s.invoice.id)).toMatchObject({ status: 'revision_manual', manualReviewReason: reason });
    const [change] = s.db
      .select()
      .from(invoiceStatusChanges)
      .where(eq(invoiceStatusChanges.invoiceId, s.invoice.id))
      .all();
    expect(change).toMatchObject({
      fromStatus: 'pendiente_de_pago',
      toStatus: 'revision_manual',
      reason,
      actorType: 'agente',
    });
    expectNoExternalCalls();
  });

  it('AC-199: el adjunto factura_proveedor.pdf se clasifica "no" y ninguna factura cambia de estado', async () => {
    const s = await clientWithDebt();
    s.receive('pagos@losandes.com', 'factura_proveedor.pdf');
    await s.tickAt(utc('2026-10-20T13:15'));

    expect(s.db.select().from(receivedAttachments).all()).toEqual([
      expect.objectContaining({ filename: 'factura_proveedor.pdf', classification: 'no' }),
    ]);
    expect(statusOf(s.db, s.invoice.id)?.status).toBe('pendiente_de_pago');
    expect(s.db.select().from(invoiceStatusChanges).all()).toHaveLength(0);
  });

  it('AC-203: el email cargado se procesa recién en la siguiente revisión y queda en el historial del cliente', async () => {
    const s = await clientWithDebt();
    const loaded = s.receive('pagos@losandes.com', 'pago_30711111111_15000.50.pdf');

    await s.tickAt(utc('2026-10-20T13:14')); // todavía no pasaron los 15 minutos del intervalo por defecto
    expect(s.db.select().from(receivedEmails).all()).toHaveLength(0);
    expect(statusOf(s.db, s.invoice.id)?.status).toBe('pendiente_de_pago');

    await s.tickAt(utc('2026-10-20T13:15'));
    const [received] = s.db.select().from(receivedEmails).all();
    expect(received).toMatchObject({
      messageId: loaded.messageId,
      receivedAt: '2026-10-20T13:00:00.000Z', // el momento de la carga (RF-202)
      clientId: s.client.id,
      classification: 'si',
    });
    const [event] = s.db
      .select()
      .from(clientEvents)
      .where(and(eq(clientEvents.clientId, s.client.id), eq(clientEvents.type, 'email_recibido')))
      .all();
    expect(event?.payload).toMatchObject({
      receivedEmailId: received?.id,
      classification: 'si',
      attachments: [expect.objectContaining({ filename: 'pago_30711111111_15000.50.pdf', classification: 'si' })],
    });
    expectNoExternalCalls();
  });
});
