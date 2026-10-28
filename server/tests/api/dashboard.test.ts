import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { clientEvents, exchangeRates, fallbackAlerts, sentEmails } from '../../src/db/schema.ts';
import { createTestApp, loggedInAgent, type TestApp } from '../helpers/test-app.ts';
import { configureIssuer, insertClient, insertInvoice } from '../helpers/test-db.ts';

const NOW = '2026-10-15T14:00:00.000Z';

/** Uso de la cotización de respaldo sin confirmar: el banner está visible (RF-69). */
function withFallbackBanner(t: TestApp) {
  const rate = t.db
    .insert(exchangeRates)
    .values({ rateCents: 152_000, source: 'dolarhoy.com', readAt: '2026-09-20T14:00:00.000Z' })
    .returning()
    .get();
  t.db.insert(fallbackAlerts).values({ exchangeRateId: rate.id, usedAt: NOW }).run();
}

describe('banner de cotización en el dashboard (RF-69, RF-70)', () => {
  it('AC-66: el dashboard muestra la cotización de respaldo usada y su fecha', async () => {
    const t = createTestApp({ now: NOW });
    withFallbackBanner(t);
    const { agent } = await loggedInAgent(t, { role: 'consulta' });

    const res = await agent.get('/api/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.banners.exchangeRate).toMatchObject({
      rateCents: 152_000,
      readAt: '2026-09-20T14:00:00.000Z',
      usedAt: NOW,
    });
    expect(res.body.banners.exchangeRate.message).toContain('20/09/2026');
  });

  it('sin uso de la cotización de respaldo no hay banner de cotización', async () => {
    const t = createTestApp({ now: NOW });
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    expect((await agent.get('/api/dashboard')).body.banners.exchangeRate).toBeNull();
  });

  it('AC-69: un Admin o un Editor confirma la cotización y el banner deja de mostrarse', async () => {
    for (const role of ['admin', 'editor'] as const) {
      const t = createTestApp({ now: NOW });
      withFallbackBanner(t);
      const { agent, user } = await loggedInAgent(t, { role });

      const res = await agent.post('/api/dashboard/exchange-rate/confirm');
      expect(res.status, role).toBe(200);
      expect(res.body.banners.exchangeRate, role).toBeNull();
      expect(t.db.select().from(fallbackAlerts).all()[0], role).toMatchObject({ confirmedByUserId: user.id });
    }
  });

  it('RF-13: un usuario Consulta no puede confirmar la cotización y el banner sigue visible', async () => {
    const t = createTestApp({ now: NOW });
    withFallbackBanner(t);
    const { agent } = await loggedInAgent(t, { role: 'consulta' });

    expect((await agent.post('/api/dashboard/exchange-rate/confirm')).status).toBe(403);
    expect((await agent.get('/api/dashboard')).body.banners.exchangeRate).not.toBeNull();
  });
});

/**
 * Clientes en distintas situaciones de deuda: Los Andes debe agosto y septiembre; Ríos está en revisión;
 * Alfil no tiene deuda; Sur está Inactivo y debe octubre.
 */
function debtScenario() {
  const t = createTestApp({ now: NOW });
  configureIssuer(t.db);
  const andes = insertClient(t.db, { businessName: 'Los Andes SRL', billingEmail: 'pagos@losandes.com' });
  insertInvoice(t.db, { clientId: andes.id, period: '2026-08', number: 1, totalCents: 1_000_000 });
  insertInvoice(t.db, { clientId: andes.id, period: '2026-09', number: 2, totalCents: 1_200_000 });
  const rios = insertClient(t.db, { businessName: 'Estudio Ríos', billingEmail: 'pagos@rios.com' });
  insertInvoice(t.db, {
    clientId: rios.id,
    period: '2026-09',
    number: 3,
    totalCents: 500_000,
    status: 'revision_manual',
  });
  insertInvoice(t.db, { clientId: rios.id, period: '2026-10', number: 4, totalCents: 500_000 });
  const alfil = insertClient(t.db, { businessName: 'Librería Alfil', billingEmail: 'pagos@alfil.com' });
  insertInvoice(t.db, { clientId: alfil.id, period: '2026-09', number: 5, status: 'pagada' });
  insertInvoice(t.db, { clientId: alfil.id, period: '2026-10', number: 6, status: 'pago_recibido' });
  const sur = insertClient(t.db, { businessName: 'Taller Sur', billingEmail: 'pagos@sur.com', status: 'inactivo' });
  insertInvoice(t.db, { clientId: sur.id, period: '2026-10', number: 7, totalCents: 300_000 });
  return { t, andes, rios, alfil, sur };
}

const manualReminders = (t: TestApp) =>
  t.db.select().from(sentEmails).where(eq(sentEmails.kind, 'recordatorio')).all();

describe('clientes con deuda vigente en el dashboard (RF-153)', () => {
  it('AC-161: lista cada cliente con deuda vigente con su deuda total, la cantidad de facturas adeudadas y si está en revisión', async () => {
    const { t, andes, rios, sur } = debtScenario();
    const { agent } = await loggedInAgent(t, { role: 'consulta' });

    const res = await agent.get('/api/dashboard');

    expect(res.status).toBe(200);
    // De la mayor deuda a la menor; Librería Alfil, sin deuda vigente, no aparece.
    expect(res.body.debtors).toEqual([
      {
        clientId: andes.id,
        businessName: 'Los Andes SRL',
        clientStatus: 'activo',
        debtCents: 2_200_000,
        owedInvoices: 2,
        inReview: false,
      },
      {
        clientId: rios.id,
        businessName: 'Estudio Ríos',
        clientStatus: 'activo',
        debtCents: 1_000_000,
        owedInvoices: 2,
        inReview: true,
      },
      {
        clientId: sur.id,
        businessName: 'Taller Sur',
        clientStatus: 'inactivo',
        debtCents: 300_000,
        owedInvoices: 1,
        inReview: false,
      },
    ]);
  });

  it('sin clientes con deuda vigente el listado está vacío', async () => {
    const t = createTestApp({ now: NOW });
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    expect((await agent.get('/api/dashboard')).body.debtors).toEqual([]);
  });
});

describe('recordatorio manual desde el dashboard (RF-154, RF-156, RF-157, RF-96)', () => {
  it.each(['admin', 'editor', 'consulta'] as const)(
    'AC-13: un %s envía el recordatorio a un cliente Activo con deuda y queda en el historial con el usuario',
    async (role) => {
      const { t, andes } = debtScenario();
      const { agent, user } = await loggedInAgent(t, { role });

      const res = await agent.post(`/api/clients/${andes.id}/reminder`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'enviado', sentAt: NOW });
      expect(t.adapters.mailSender.sent.map((email) => email.to)).toEqual(['pagos@losandes.com']);
      expect(manualReminders(t)).toEqual([
        expect.objectContaining({
          clientId: andes.id,
          trigger: 'manual',
          reminderMonth: null,
          sentByUserId: user.id,
          sentAt: NOW,
        }),
      ]);
      const [event] = t.db
        .select()
        .from(clientEvents)
        .where(and(eq(clientEvents.clientId, andes.id), eq(clientEvents.type, 'email_enviado')))
        .all();
      // AC-12: el evento guarda el usuario, para mostrar su nombre en el historial (la API llega en US8).
      expect(event).toMatchObject({
        actorType: 'usuario',
        userId: user.id,
        payload: expect.objectContaining({ kind: 'recordatorio', trigger: 'manual' }),
      });
    },
  );

  it('AC-158: el recordatorio manual detalla cada factura adeudada, el total y pide el comprobante', async () => {
    const { t, andes } = debtScenario();
    const { agent } = await loggedInAgent(t, { role: 'editor' });
    await agent.post(`/api/clients/${andes.id}/reminder`);

    const text = (t.adapters.mailSender.sent[0]?.text ?? '').replace(/\s+/g, ' ');
    for (const value of ['00003-00000001', 'agosto de 2026', '$ 10.000,00', '00003-00000002', '$ 12.000,00']) {
      expect(text).toContain(value);
    }
    expect(text).toMatch(/total a pagar.*\$ 22\.000,00/i);
    expect(text).toMatch(/adjuntando el comprobante de pago/i);
  });

  it.each([
    ['AC-163', 'alfil', 'sin_deuda', /no tiene deuda pendiente/i],
    ['AC-164', 'rios', 'en_revision', /pago en revisión manual/i],
    ['AC-89', 'sur', 'cliente_inactivo', /Inactivo/],
  ] as const)('%s: bloquea el recordatorio con un mensaje y no envía ningún email', async (_ac, key, code, message) => {
    const scenario = debtScenario();
    const { agent } = await loggedInAgent(scenario.t, { role: 'admin' });

    const res = await agent.post(`/api/clients/${scenario[key].id}/reminder`);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe(code);
    expect(res.body.error.message).toMatch(message);
    expect(scenario.t.adapters.mailSender.attempts).toHaveLength(0);
    expect(manualReminders(scenario.t)).toHaveLength(0);
  });

  it('un cliente inexistente da 404', async () => {
    const { t } = debtScenario();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    expect((await agent.post('/api/clients/999/reminder')).status).toBe(404);
  });

  it('si el envío falla, responde 502 con el error y no registra el recordatorio', async () => {
    const { t, andes } = debtScenario();
    t.adapters.mailSender.steps.push(new Error('Gmail no respondió'));
    const { agent } = await loggedInAgent(t, { role: 'admin' });

    const res = await agent.post(`/api/clients/${andes.id}/reminder`);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('envio_fallido');
    expect(manualReminders(t)).toHaveLength(0);
  });
});
