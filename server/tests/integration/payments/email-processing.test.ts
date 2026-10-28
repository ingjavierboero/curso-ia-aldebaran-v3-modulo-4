import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { ClassificationResult, IncomingEmail } from '../../../src/adapters/types.ts';
import {
  clientEvents,
  clients,
  invoiceEmails,
  invoices,
  invoiceStatusChanges,
  notices,
  receivedAttachments,
  receivedEmails,
} from '../../../src/db/schema.ts';
import { processEmails } from '../../../src/services/payment-processing.ts';
import { createTestApp, type TestApp } from '../../helpers/test-app.ts';
import { insertClient, insertInvoice } from '../../helpers/test-db.ts';

const CUIT = '30711111111';
const EMAIL = 'pagos@losandes.com';

const PDF = new TextEncoder().encode('%PDF-1.7 comprobante');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const HTML = new TextEncoder().encode('<html><script>fetch("/api/users")</script></html>');
const DOCX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]);

const pdf = (filename: string) => ({ filename, mimeType: 'application/pdf', content: PDF, inline: false });

/** Email entrante; por defecto, del cliente y con un PDF adjunto. */
function incoming(overrides: Partial<IncomingEmail> & { messageId: string }): IncomingEmail {
  return {
    from: EMAIL,
    subject: 'Pago',
    bodyText: 'Adjunto el comprobante.',
    receivedAt: new Date('2026-10-20T13:00:00.000Z'),
    attachments: [pdf('comprobante.pdf')],
    ...overrides,
  };
}

const si = (amountRaw: string | null, cuit: string | null = CUIT): ClassificationResult => ({ kind: 'si', cuit, amountRaw });

/** Cliente con una factura adeudada de $10.000 en Pendiente de pago. */
function withDebt(t: TestApp, clientOverrides: Parameters<typeof insertClient>[1] = {}) {
  const client = insertClient(t.db, { cuit: CUIT, billingEmail: EMAIL, ...clientOverrides });
  const invoice = insertInvoice(t.db, { clientId: client.id, period: '2026-10', totalCents: 1_000_000 });
  return { client, invoice };
}

const app = () => createTestApp({ now: '2026-10-20T14:00:00.000Z' });
const invoiceById = (t: TestApp, id: number) => t.db.select().from(invoices).where(eq(invoices.id, id)).get();
const emailsReceived = (t: TestApp) => t.db.select().from(receivedEmails).orderBy(asc(receivedEmails.id)).all();
const eventsOf = (t: TestApp, clientId: number) =>
  t.db.select().from(clientEvents).where(eq(clientEvents.clientId, clientId)).orderBy(asc(clientEvents.id)).all();
const emailsOfInvoice = (t: TestApp, invoiceId: number) =>
  t.db
    .select({ messageId: receivedEmails.messageId })
    .from(invoiceEmails)
    .innerJoin(receivedEmails, eq(invoiceEmails.receivedEmailId, receivedEmails.id))
    .where(eq(invoiceEmails.invoiceId, invoiceId))
    .orderBy(asc(receivedEmails.id))
    .all()
    .map((r) => r.messageId);

describe('identificación del email (RF-109 a RF-113)', () => {
  it('AC-100: un email con un Message-ID ya procesado no se registra de nuevo ni se envía al LLM', async () => {
    const t = app();
    const { client } = withDebt(t);
    t.adapters.classifier.fallback = { kind: 'no' };

    await processEmails(t.ctx, [incoming({ messageId: '<a@x>' })]);
    await processEmails(t.ctx, [incoming({ messageId: '<a@x>' })]);

    expect(emailsReceived(t)).toHaveLength(1);
    expect(t.adapters.classifier.calls).toHaveLength(1);
    expect(eventsOf(t, client.id).filter((e) => e.type === 'email_recibido')).toHaveLength(1);
  });

  it('AC-101: un email cuyo remitente es la casilla del sistema no se procesa', async () => {
    const t = app();
    withDebt(t);
    await processEmails(t.ctx, [incoming({ messageId: '<a@x>', from: 'Sistema@Aldebaran.test' })]);
    expect(emailsReceived(t)).toEqual([]);
    expect(t.db.select().from(notices).all()).toEqual([]);
    expect(t.adapters.classifier.calls).toHaveLength(0);
  });

  it('AC-102: un remitente que no es ningún cliente queda como aviso Pendiente, sin LLM ni cambios', async () => {
    const t = app();
    const { invoice } = withDebt(t);
    await processEmails(t.ctx, [incoming({ messageId: '<a@x>', from: 'otro@desconocido.com' })]);

    const [received] = emailsReceived(t);
    expect(received).toMatchObject({ clientId: null, fromAddress: 'otro@desconocido.com' });
    expect(t.db.select().from(notices).all()).toEqual([
      expect.objectContaining({ receivedEmailId: received?.id, status: 'pendiente' }),
    ]);
    expect(t.adapters.classifier.calls).toHaveLength(0);
    expect(invoiceById(t, invoice.id)?.status).toBe('pendiente_de_pago');
  });

  it('AC-103: el remitente se compara sin distinguir mayúsculas', async () => {
    const t = app();
    const { client } = withDebt(t);
    await processEmails(t.ctx, [incoming({ messageId: '<a@x>', from: 'Pagos@LosAndes.com' })]);
    expect(emailsReceived(t)[0]?.clientId).toBe(client.id);
    expect(t.db.select().from(notices).all()).toEqual([]);
  });

  it('AC-35: después de cambiar el email de facturación, la dirección anterior ya no se reconoce y la nueva sí', async () => {
    const t = app();
    const { client } = withDebt(t);
    t.db.update(clients).set({ billingEmail: 'nuevo@losandes.com', billingEmailNormalized: 'nuevo@losandes.com' }).where(eq(clients.id, client.id)).run();

    await processEmails(t.ctx, [
      incoming({ messageId: '<viejo@x>', from: EMAIL, attachments: [] }),
      incoming({ messageId: '<nuevo@x>', from: 'nuevo@losandes.com', attachments: [] }),
    ]);
    expect(emailsReceived(t).map((e) => [e.messageId, e.clientId])).toEqual([
      ['<viejo@x>', null],
      ['<nuevo@x>', client.id],
    ]);
  });
});

describe('historial y adjuntos (RF-114 a RF-118, RF-124)', () => {
  it('AC-104: el email queda en el historial del cliente con su fecha, asunto y adjuntos', async () => {
    const t = app();
    const { client } = withDebt(t);
    await processEmails(t.ctx, [incoming({ messageId: '<a@x>', subject: 'Pago octubre' })]);

    expect(eventsOf(t, client.id)).toContainEqual(
      expect.objectContaining({
        type: 'email_recibido',
        actorType: 'agente',
        payload: expect.objectContaining({
          subject: 'Pago octubre',
          receivedAt: '2026-10-20T13:00:00.000Z',
          attachments: [expect.objectContaining({ filename: 'comprobante.pdf' })],
        }),
      }),
    );
  });

  it('AC-105: un email sin adjuntos no se envía al LLM ni cambia facturas', async () => {
    const t = app();
    const { invoice } = withDebt(t);
    await processEmails(t.ctx, [incoming({ messageId: '<a@x>', attachments: [] })]);
    expect(t.adapters.classifier.calls).toHaveLength(0);
    expect(emailsReceived(t)[0]?.classification).toBeNull();
    expect(invoiceById(t, invoice.id)?.status).toBe('pendiente_de_pago');
  });

  it('AC-106, AC-107: una imagen embebida y un .docx no cuentan como adjuntos; un PNG y un PDF se envían al LLM', async () => {
    const t = app();
    withDebt(t);
    await processEmails(t.ctx, [
      incoming({
        messageId: '<a@x>',
        attachments: [
          { filename: 'logo.png', mimeType: 'image/png', content: PNG, inline: true },
          { filename: 'nota.docx', mimeType: 'application/msword', content: DOCX, inline: false },
        ],
      }),
      incoming({
        messageId: '<b@x>',
        attachments: [{ filename: 'captura.png', mimeType: 'image/png', content: PNG, inline: false }, pdf('comprobante.pdf')],
      }),
    ]);
    expect(t.adapters.classifier.calls.map((c) => c.filename)).toEqual(['captura.png', 'comprobante.pdf']);
  });

  it('AC-254, RF-117: un comprobante.pdf que declara application/pdf pero contiene HTML se trata como email sin adjunto y no se guarda', async () => {
    const t = app();
    const { invoice } = withDebt(t);
    await processEmails(t.ctx, [
      incoming({ messageId: '<a@x>', attachments: [{ filename: 'comprobante.pdf', mimeType: 'application/pdf', content: HTML, inline: false }] }),
    ]);
    expect(t.adapters.classifier.calls).toHaveLength(0);
    expect(t.db.select().from(receivedAttachments).all()).toEqual([]);
    expect(emailsReceived(t)[0]?.classification).toBeNull();
    expect(invoiceById(t, invoice.id)?.status).toBe('pendiente_de_pago');
  });

  it('el tipo guardado de cada adjunto es el verificado por su firma, no el declarado', async () => {
    const t = app();
    withDebt(t);
    await processEmails(t.ctx, [
      incoming({ messageId: '<a@x>', attachments: [{ filename: 'foto.jpg', mimeType: 'image/jpeg', content: PNG, inline: false }] }),
    ]);
    expect(t.db.select().from(receivedAttachments).all()[0]?.mimeType).toBe('image/png');
    expect(t.adapters.classifier.calls[0]?.mimeType).toBe('image/png');
  });

  it('AC-112, AC-113: registra la clasificación de cada adjunto, el CUIT y el monto de cada comprobante y la del email', async () => {
    const t = app();
    const { client } = withDebt(t);
    t.adapters.classifier.byFilename.set('a.pdf', si('4000'));
    t.adapters.classifier.byFilename.set('b.pdf', si('6000', '30-71111111-1'));
    t.adapters.classifier.byFilename.set('c.pdf', { kind: 'no' });

    await processEmails(t.ctx, [incoming({ messageId: '<a@x>', attachments: [pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')] })]);

    expect(emailsReceived(t)[0]?.classification).toBe('si');
    expect(
      t.db
        .select({ f: receivedAttachments.filename, c: receivedAttachments.classification, cuit: receivedAttachments.extractedCuit, amount: receivedAttachments.extractedAmountCents })
        .from(receivedAttachments)
        .orderBy(asc(receivedAttachments.id))
        .all(),
    ).toEqual([
      { f: 'a.pdf', c: 'si', cuit: CUIT, amount: 400_000 },
      { f: 'b.pdf', c: 'si', cuit: CUIT, amount: 600_000 },
      { f: 'c.pdf', c: 'no', cuit: null, amount: null },
    ]);
    const event = eventsOf(t, client.id).find((e) => e.type === 'email_recibido');
    expect(event?.payload).toMatchObject({
      classification: 'si',
      attachments: [
        { filename: 'a.pdf', classification: 'si', cuit: CUIT, amountRaw: '4000' },
        { filename: 'b.pdf', classification: 'si', cuit: CUIT, amountRaw: '6000' },
        { filename: 'c.pdf', classification: 'no' },
      ],
    });
  });

  it('AC-115: la marca de procesamiento erróneo queda registrada en el historial', async () => {
    const t = app();
    const { client } = withDebt(t);
    t.adapters.classifier.fallback = { kind: 'error', message: 'El LLM falló después de 4 intentos: HTTP 500' };
    await processEmails(t.ctx, [incoming({ messageId: '<a@x>' })]);

    expect(emailsReceived(t)[0]?.classification).toBe('error');
    expect(eventsOf(t, client.id).find((e) => e.type === 'email_recibido')?.payload).toMatchObject({
      classification: 'error',
      attachments: [expect.objectContaining({ classification: 'error', error: expect.stringContaining('HTTP 500') })],
    });
  });

  it('AC-108, RF-118: el comprobante de un cliente Inactivo se procesa igual', async () => {
    const t = app();
    const { invoice } = withDebt(t, { status: 'inactivo' });
    t.adapters.classifier.fallback = si('10000');
    await processEmails(t.ctx, [incoming({ messageId: '<a@x>' })]);
    expect(invoiceById(t, invoice.id)?.status).toBe('pago_recibido');
  });

  it('AC-120, AC-121: sin deuda vigente, el email queda en el historial y no cambia ninguna factura', async () => {
    const t = app();
    const client = insertClient(t.db, { cuit: CUIT, billingEmail: EMAIL });
    const paid = insertInvoice(t.db, { clientId: client.id, period: '2026-09', status: 'pagada' });
    t.adapters.classifier.fallback = si('10000');
    await processEmails(t.ctx, [incoming({ messageId: '<a@x>' })]);
    expect(invoiceById(t, paid.id)?.status).toBe('pagada');
    expect(eventsOf(t, client.id).some((e) => e.type === 'email_recibido')).toBe(true);
    expect(emailsReceived(t)[0]?.appliedRule).toBe('RF-127');
  });
});

describe('aplicación de las reglas (RF-126 a RF-140)', () => {
  it('AC-245, RF-138, RF-139: las facturas que cambian quedan con el motivo, el cambio de estado registrado y el email asociado', async () => {
    const t = app();
    const { client } = withDebt(t);
    const second = insertInvoice(t.db, { clientId: client.id, period: '2026-09', totalCents: 500_000 });
    t.adapters.classifier.fallback = si('1234');
    await processEmails(t.ctx, [incoming({ messageId: '<parcial@x>' })]);

    for (const invoice of t.db.select().from(invoices).where(eq(invoices.clientId, client.id)).all()) {
      expect(invoice).toMatchObject({ status: 'revision_manual', manualReviewReason: 'monto no coincide' });
      expect(emailsOfInvoice(t, invoice.id)).toEqual(['<parcial@x>']);
    }
    expect(t.db.select().from(invoiceStatusChanges).where(eq(invoiceStatusChanges.invoiceId, second.id)).all()).toEqual([
      expect.objectContaining({
        fromStatus: 'pendiente_de_pago',
        toStatus: 'revision_manual',
        reason: 'monto no coincide',
        actorType: 'agente',
        receivedEmailId: emailsReceived(t)[0]?.id,
      }),
    ]);
    expect(eventsOf(t, client.id).filter((e) => e.type === 'estado_factura')).toHaveLength(2);
  });

  it('AC-124, RF-128, RF-139: un comprobante nuevo de un cliente en revisión queda asociado a la revisión pendiente', async () => {
    const t = app();
    const { invoice } = withDebt(t);
    t.adapters.classifier.fallback = si('1');
    await processEmails(t.ctx, [incoming({ messageId: '<primero@x>' })]);
    expect(invoiceById(t, invoice.id)).toMatchObject({ status: 'revision_manual', manualReviewReason: 'monto no coincide' });

    t.adapters.classifier.fallback = si('10000');
    await processEmails(t.ctx, [incoming({ messageId: '<segundo@x>', receivedAt: new Date('2026-10-20T13:30:00.000Z') })]);

    expect(invoiceById(t, invoice.id)).toMatchObject({ status: 'revision_manual', manualReviewReason: 'revisión manual pendiente' });
    expect(emailsOfInvoice(t, invoice.id)).toEqual(['<primero@x>', '<segundo@x>']);
  });

  it('AC-37: con un CUIT cambiado, un comprobante con el CUIT anterior pasa las facturas a Revisión manual con "CUIT no coincide"', async () => {
    const t = app();
    const { client, invoice } = withDebt(t);
    t.db.update(clients).set({ cuit: '20111111112' }).where(eq(clients.id, client.id)).run();
    t.adapters.classifier.fallback = si('10000', CUIT);
    await processEmails(t.ctx, [incoming({ messageId: '<a@x>' })]);
    expect(invoiceById(t, invoice.id)).toMatchObject({ status: 'revision_manual', manualReviewReason: 'CUIT no coincide' });
  });

  it('AC-152: una factura que un usuario devolvió a Pendiente de pago se vuelve a validar con un comprobante nuevo', async () => {
    const t = app();
    const { invoice } = withDebt(t);
    t.db
      .insert(invoiceStatusChanges)
      .values({ invoiceId: invoice.id, fromStatus: 'pago_recibido', toStatus: 'pendiente_de_pago', actorType: 'usuario', changedAt: '2026-10-19T12:00:00.000Z' })
      .run();
    t.adapters.classifier.fallback = si('10000');
    await processEmails(t.ctx, [incoming({ messageId: '<a@x>' })]);
    expect(invoiceById(t, invoice.id)).toMatchObject({ status: 'pago_recibido', manualReviewReason: null });
  });

  it('AC-243, RF-108: los emails de una misma revisión se procesan en orden de recepción', async () => {
    const t = app();
    const { invoice } = withDebt(t);
    t.adapters.classifier.byFilename.set('dudoso_1.pdf', { kind: 'dudoso' });
    t.adapters.classifier.byFilename.set('pago.pdf', si('10000'));

    // Llegan desordenados: el de las 10:05 primero en la lista.
    await processEmails(t.ctx, [
      incoming({ messageId: '<1005@x>', receivedAt: new Date('2026-10-20T13:05:00.000Z'), attachments: [pdf('pago.pdf')] }),
      incoming({ messageId: '<1000@x>', receivedAt: new Date('2026-10-20T13:00:00.000Z'), attachments: [pdf('dudoso_1.pdf')] }),
    ]);

    expect(emailsReceived(t).map((e) => [e.messageId, e.appliedRule])).toEqual([
      ['<1000@x>', 'RF-131'],
      ['<1005@x>', 'RF-128'],
    ]);
    expect(invoiceById(t, invoice.id)).toMatchObject({ status: 'revision_manual', manualReviewReason: 'revisión manual pendiente' });
    const changes = t.db
      .select({ reason: invoiceStatusChanges.reason })
      .from(invoiceStatusChanges)
      .where(eq(invoiceStatusChanges.invoiceId, invoice.id))
      .orderBy(asc(invoiceStatusChanges.id))
      .all();
    expect(changes.map((c) => c.reason)).toEqual(['clasificación dudosa', 'revisión manual pendiente']);
  });

  it('RF-134: un comprobante que coincide pasa la factura a Pago recibido', async () => {
    const t = app();
    const { invoice } = withDebt(t);
    t.adapters.classifier.fallback = si('10000');
    await processEmails(t.ctx, [incoming({ messageId: '<a@x>' })]);
    expect(invoiceById(t, invoice.id)?.status).toBe('pago_recibido');
    expect(emailsOfInvoice(t, invoice.id)).toEqual(['<a@x>']);
  });
});
