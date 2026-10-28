import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  clientEvents,
  invoiceEmails,
  invoices,
  invoiceStatusChanges,
  notices,
  receivedAttachments,
  receivedEmails,
} from '../../src/db/schema.ts';
import { createTestApp, loggedInAgent, type TestApp } from '../helpers/test-app.ts';
import { insertClient, insertInvoice } from '../helpers/test-db.ts';

const NOW = '2026-10-20T15:00:00.000Z';
const PDF = Buffer.from('%PDF-1.7 comprobante');
const MINUTE = 60_000;

/** Email recibido con un comprobante "si", como lo deja el procesamiento del agente. */
function insertReceivedEmail(
  t: TestApp,
  input: { clientId: number | null; messageId: string; receivedAt?: string; amountCents?: number; classification?: 'si' | null },
) {
  const email = t.db
    .insert(receivedEmails)
    .values({
      messageId: input.messageId,
      fromAddress: input.clientId ? 'pagos@losandes.com' : 'otro@desconocido.com',
      fromNormalized: input.clientId ? 'pagos@losandes.com' : 'otro@desconocido.com',
      subject: `Pago ${input.messageId}`,
      bodyText: 'Adjunto el comprobante.',
      receivedAt: input.receivedAt ?? '2026-10-20T13:00:00.000Z',
      clientId: input.clientId,
      classification: input.clientId ? 'si' : null,
      processedAt: NOW,
    })
    .returning()
    .get();
  const attachment = t.db
    .insert(receivedAttachments)
    .values({
      receivedEmailId: email.id,
      filename: 'comprobante.pdf',
      mimeType: 'application/pdf',
      content: PDF,
      classification: input.classification === undefined ? (input.clientId ? 'si' : null) : input.classification,
      extractedCuit: input.clientId ? '30711111111' : null,
      extractedAmountCents: input.clientId ? (input.amountCents ?? 1_000_000) : null,
      extractedAmountRaw: input.clientId ? String((input.amountCents ?? 1_000_000) / 100) : null,
    })
    .returning()
    .get();
  return { email, attachment };
}

const link = (t: TestApp, invoiceId: number, receivedEmailId: number) =>
  t.db.insert(invoiceEmails).values({ invoiceId, receivedEmailId }).run();

function setup() {
  const t = createTestApp({ now: NOW });
  const client = insertClient(t.db, { businessName: 'Los Andes SRL', cuit: '30711111111', billingEmail: 'pagos@losandes.com' });
  return { t, client };
}

const invoiceById = (t: TestApp, id: number) => t.db.select().from(invoices).where(eq(invoices.id, id)).get();
const changeStatus = (agent: Awaited<ReturnType<typeof loggedInAgent>>['agent'], id: number, to: string, expectedStatus: string) =>
  agent.post(`/api/invoices/${id}/status`).send({ to, expectedStatus });

describe('pagos a revisar (RF-141)', () => {
  it('AC-144: muestra las facturas en Pago recibido y Revisión manual con su email, adjuntos, clasificación, CUIT, monto y motivo, y no las de otros estados', async () => {
    const { t, client } = setup();
    const received = insertInvoice(t.db, { clientId: client.id, period: '2026-10', status: 'pago_recibido', number: 2, pointOfSale: 3 });
    const review = insertInvoice(t.db, {
      clientId: client.id,
      period: '2026-09',
      status: 'revision_manual',
      manualReviewReason: 'monto no coincide',
      number: 1,
      pointOfSale: 3,
    });
    insertInvoice(t.db, { clientId: client.id, period: '2026-08', status: 'pendiente_de_pago' });
    insertInvoice(t.db, { clientId: client.id, period: '2026-07', status: 'pagada' });
    const ok = insertReceivedEmail(t, { clientId: client.id, messageId: '<ok@x>' });
    const partial = insertReceivedEmail(t, { clientId: client.id, messageId: '<parcial@x>', amountCents: 123_400 });
    link(t, received.id, ok.email.id);
    link(t, review.id, partial.email.id);

    const { agent } = await loggedInAgent(t, { role: 'consulta' });
    const res = await agent.get('/api/review/payments');
    expect(res.status).toBe(200);
    expect(res.body.map((p: { invoice: { id: number } }) => p.invoice.id).sort()).toEqual([received.id, review.id].sort());

    const reviewed = res.body.find((p: { invoice: { id: number } }) => p.invoice.id === review.id);
    expect(reviewed.invoice).toMatchObject({
      clientName: 'Los Andes SRL',
      period: '2026-09',
      voucherNumber: '00003-00000001',
      status: 'revision_manual',
      reason: 'monto no coincide',
    });
    expect(reviewed.emails).toEqual([
      expect.objectContaining({
        id: partial.email.id,
        from: 'pagos@losandes.com',
        subject: 'Pago <parcial@x>',
        classification: 'si',
        attachments: [
          expect.objectContaining({
            id: partial.attachment.id,
            filename: 'comprobante.pdf',
            classification: 'si',
            cuit: '30711111111',
            amountCents: 123_400,
          }),
        ],
      }),
    ]);
    const withPayment = res.body.find((p: { invoice: { id: number } }) => p.invoice.id === received.id);
    expect(withPayment.invoice.reason).toBeNull();
  });
});

describe('avisos (RF-142, RF-148)', () => {
  it('AC-145: muestra los avisos Pendientes con remitente, asunto, fecha y adjuntos, y no los Revisados', async () => {
    const { t } = setup();
    const pendingEmail = insertReceivedEmail(t, { clientId: null, messageId: '<desconocido@x>' });
    const reviewedEmail = insertReceivedEmail(t, { clientId: null, messageId: '<revisado@x>' });
    const pending = t.db.insert(notices).values({ receivedEmailId: pendingEmail.email.id, status: 'pendiente' }).returning().get();
    t.db.insert(notices).values({ receivedEmailId: reviewedEmail.email.id, status: 'revisado' }).run();

    const { agent } = await loggedInAgent(t, { role: 'consulta' });
    const res = await agent.get('/api/review/notices');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        id: pending.id,
        email: expect.objectContaining({
          from: 'otro@desconocido.com',
          subject: 'Pago <desconocido@x>',
          receivedAt: '2026-10-20T13:00:00.000Z',
          attachments: [expect.objectContaining({ filename: 'comprobante.pdf', classification: null })],
        }),
      }),
    ]);
  });

  it('AC-153: un Editor marca un aviso como Revisado: deja de estar entre los Pendientes y queda registrado quién lo revisó', async () => {
    const { t } = setup();
    const email = insertReceivedEmail(t, { clientId: null, messageId: '<desconocido@x>' });
    const notice = t.db.insert(notices).values({ receivedEmailId: email.email.id, status: 'pendiente' }).returning().get();
    const { agent, user } = await loggedInAgent(t, { role: 'editor' });

    expect((await agent.post(`/api/review/notices/${notice.id}/reviewed`)).status).toBe(200);
    expect((await agent.get('/api/review/notices')).body).toEqual([]);
    expect(t.db.select().from(notices).where(eq(notices.id, notice.id)).get()).toMatchObject({
      status: 'revisado',
      reviewedByUserId: user.id,
      reviewedAt: NOW,
    });
  });

  it('RF-13: un usuario Consulta no puede marcar un aviso como Revisado', async () => {
    const { t } = setup();
    const email = insertReceivedEmail(t, { clientId: null, messageId: '<desconocido@x>' });
    const notice = t.db.insert(notices).values({ receivedEmailId: email.email.id, status: 'pendiente' }).returning().get();
    const { agent } = await loggedInAgent(t, { role: 'consulta' });
    expect((await agent.post(`/api/review/notices/${notice.id}/reviewed`)).status).toBe(403);
    expect(t.db.select().from(notices).where(eq(notices.id, notice.id)).get()?.status).toBe('pendiente');
  });
});

describe('decisiones del usuario (RF-143 a RF-147)', () => {
  for (const [label, from, to] of [
    ['AC-10, AC-146: de Pago recibido a Pagada', 'pago_recibido', 'pagada'],
    ['AC-147: de Pago recibido a Pendiente de pago', 'pago_recibido', 'pendiente_de_pago'],
    ['AC-148: de Revisión manual a Pagada', 'revision_manual', 'pagada'],
    ['AC-149: de Revisión manual a Pendiente de pago', 'revision_manual', 'pendiente_de_pago'],
    ['AC-150: de Pendiente de pago a Pagada, desde el listado de facturas', 'pendiente_de_pago', 'pagada'],
  ] as const) {
    it(`${label}: un Editor cambia el estado y el cambio queda registrado con su usuario`, async () => {
      const { t, client } = setup();
      const invoice = insertInvoice(t.db, {
        clientId: client.id,
        period: '2026-10',
        status: from,
        manualReviewReason: from === 'revision_manual' ? 'monto no coincide' : null,
      });
      const { agent, user } = await loggedInAgent(t, { role: 'editor' });

      const res = await changeStatus(agent, invoice.id, to, from);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: invoice.id, status: to });
      // AC-151, RF-140: al salir de Revisión manual la factura deja de tener motivo.
      expect(invoiceById(t, invoice.id)).toMatchObject({ status: to, manualReviewReason: null });
      expect(t.db.select().from(invoiceStatusChanges).where(eq(invoiceStatusChanges.invoiceId, invoice.id)).all()).toEqual([
        expect.objectContaining({
          fromStatus: from,
          toStatus: to,
          previousReason: from === 'revision_manual' ? 'monto no coincide' : null,
          actorType: 'usuario',
          userId: user.id,
          changedAt: NOW,
        }),
      ]);
      expect(t.db.select().from(clientEvents).where(eq(clientEvents.clientId, client.id)).all()).toEqual([
        expect.objectContaining({ type: 'estado_factura', actorType: 'usuario', userId: user.id }),
      ]);
    });
  }

  it('una transición que el usuario no puede hacer se rechaza (por ejemplo, de Pagada a Pendiente de pago)', async () => {
    const { t, client } = setup();
    const invoice = insertInvoice(t.db, { clientId: client.id, period: '2026-10', status: 'pagada' });
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const res = await changeStatus(agent, invoice.id, 'pendiente_de_pago', 'pagada');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('transicion_invalida');
    expect(invoiceById(t, invoice.id)?.status).toBe('pagada');
  });

  it('un destino que no es Pagada ni Pendiente de pago se rechaza', async () => {
    const { t, client } = setup();
    const invoice = insertInvoice(t.db, { clientId: client.id, period: '2026-10', status: 'pago_recibido' });
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    expect((await changeStatus(agent, invoice.id, 'revision_manual', 'pago_recibido')).status).toBe(400);
    expect(invoiceById(t, invoice.id)?.status).toBe('pago_recibido');
  });

  it('RF-13: un usuario Consulta no puede cambiar el estado de una factura', async () => {
    const { t, client } = setup();
    const invoice = insertInvoice(t.db, { clientId: client.id, period: '2026-10', status: 'pago_recibido' });
    const { agent } = await loggedInAgent(t, { role: 'consulta' });
    expect((await changeStatus(agent, invoice.id, 'pagada', 'pago_recibido')).status).toBe(403);
    expect(invoiceById(t, invoice.id)?.status).toBe('pago_recibido');
  });

  it('una factura inexistente responde 404', async () => {
    const { t } = setup();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    expect((await changeStatus(agent, 999, 'pagada', 'pago_recibido')).status).toBe(404);
  });
});

describe('pagos resueltos (RF-216)', () => {
  it('AC-238: una decisión aparece entre los resueltos con la decisión, el usuario, la fecha, el estado y el motivo previos y los comprobantes', async () => {
    const { t, client } = setup();
    const review = insertInvoice(t.db, {
      clientId: client.id,
      period: '2026-09',
      status: 'revision_manual',
      manualReviewReason: 'monto no coincide',
    });
    const returned = insertInvoice(t.db, { clientId: client.id, period: '2026-10', status: 'pago_recibido' });
    const first = insertReceivedEmail(t, { clientId: client.id, messageId: '<uno@x>', amountCents: 500_000 });
    const second = insertReceivedEmail(t, { clientId: client.id, messageId: '<dos@x>', amountCents: 400_000 });
    link(t, review.id, first.email.id);
    link(t, review.id, second.email.id);
    const { agent, user } = await loggedInAgent(t, { role: 'editor' });

    await changeStatus(agent, review.id, 'pagada', 'revision_manual');
    t.adapters.clock.advance(5 * MINUTE);
    await changeStatus(agent, returned.id, 'pendiente_de_pago', 'pago_recibido');

    expect((await agent.get('/api/review/payments')).body).toEqual([]);
    const res = await agent.get('/api/review/resolved');
    expect(res.status).toBe(200);
    // De la decisión más reciente a la más antigua.
    expect(res.body).toEqual([
      expect.objectContaining({
        invoice: expect.objectContaining({ id: returned.id }),
        decision: 'pendiente_de_pago',
        previousStatus: 'pago_recibido',
      }),
      expect.objectContaining({
        invoice: expect.objectContaining({ id: review.id, clientName: 'Los Andes SRL' }),
        decision: 'pagada',
        decidedBy: { id: user.id, name: user.name },
        decidedAt: NOW,
        previousStatus: 'revision_manual',
        previousReason: 'monto no coincide',
        emails: [expect.objectContaining({ id: first.email.id }), expect.objectContaining({ id: second.email.id })],
      }),
    ]);
  });

  it('pasar a Pagada desde el listado una factura Pendiente de pago no es una decisión de revisión', async () => {
    const { t, client } = setup();
    const invoice = insertInvoice(t.db, { clientId: client.id, period: '2026-10', status: 'pendiente_de_pago' });
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    await changeStatus(agent, invoice.id, 'pagada', 'pendiente_de_pago');
    expect((await agent.get('/api/review/resolved')).body).toEqual([]);
  });

  it('RF-216: los resueltos se filtran por cliente y por rango de fechas de la decisión (días de Argentina)', async () => {
    const { t, client } = setup();
    const other = insertClient(t.db, { businessName: 'Otro SA' });
    const a = insertInvoice(t.db, { clientId: client.id, period: '2026-09', status: 'pago_recibido' });
    const b = insertInvoice(t.db, { clientId: other.id, period: '2026-09', status: 'pago_recibido' });
    const c = insertInvoice(t.db, { clientId: client.id, period: '2026-10', status: 'pago_recibido' });
    const { agent } = await loggedInAgent(t, { role: 'admin' });

    t.adapters.clock.set('2026-10-18T15:00:00.000Z');
    await changeStatus(agent, a.id, 'pagada', 'pago_recibido');
    await changeStatus(agent, b.id, 'pagada', 'pago_recibido');
    // 01:00 UTC del 21 todavía es el 20 en Argentina.
    t.adapters.clock.set('2026-10-21T01:00:00.000Z');
    await changeStatus(agent, c.id, 'pagada', 'pago_recibido');

    const ids = async (query: string) =>
      (await agent.get(`/api/review/resolved${query}`)).body.map((r: { invoice: { id: number } }) => r.invoice.id);
    expect(await ids(`?clientId=${client.id}`)).toEqual([c.id, a.id]);
    expect(await ids('?from=2026-10-19&to=2026-10-20')).toEqual([c.id]);
    expect(await ids('?to=2026-10-18')).toEqual([b.id, a.id]);
    expect(await ids(`?clientId=${other.id}&from=2026-10-19`)).toEqual([]);
  });

  it('un filtro con una fecha inválida se rechaza', async () => {
    const { t } = setup();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    expect((await agent.get('/api/review/resolved?from=2026-02-31')).status).toBe(400);
  });

  it('cualquier perfil ve los resueltos', async () => {
    const { t } = setup();
    for (const role of ['admin', 'editor', 'consulta'] as const) {
      const { agent } = await loggedInAgent(t, { role });
      expect((await agent.get('/api/review/resolved')).status, role).toBe(200);
    }
  });
});
