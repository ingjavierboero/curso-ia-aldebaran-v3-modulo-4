/**
 * Reintento manual de un recordatorio que falló (RF-178, FR-046): se arma con las facturas adeudadas y la
 * deuda vigente del cliente al momento del reintento, y se bloquea con un mensaje, dejando el error
 * Pendiente, si el cliente ya no corresponde.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { clients, invoices, processErrors, sentEmails } from '../../src/db/schema.ts';
import { recordProcessError } from '../../src/services/process-errors.ts';
import { createTestApp, loggedInAgent, type TestApp } from '../helpers/test-app.ts';
import { configureIssuer, insertClient, insertInvoice } from '../helpers/test-db.ts';

/** 1/11/2026 a las 10:00 de Argentina: el recordatorio de octubre falló el 31. */
const NOW = '2026-11-01T13:00:00.000Z';

/**
 * Los Andes debía agosto ($10.000) y septiembre ($12.000) cuando falló el recordatorio de octubre;
 * desde entonces pagó agosto y se le facturó octubre ($15.000).
 */
function failedReminder() {
  const t = createTestApp({ now: NOW });
  configureIssuer(t.db);
  const client = insertClient(t.db, { businessName: 'Los Andes SRL', billingEmail: 'pagos@losandes.com' });
  const august = insertInvoice(t.db, { clientId: client.id, period: '2026-08', number: 1, totalCents: 1_000_000 });
  const september = insertInvoice(t.db, {
    clientId: client.id,
    period: '2026-09',
    number: 2,
    totalCents: 1_200_000,
  });
  const error = recordProcessError(t.db, {
    operation: 'envio_recordatorio',
    clientId: client.id,
    period: '2026-10',
    attempts: 4,
    message: 'Gmail rechazó el envío',
    now: new Date('2026-10-31T14:15:00.000Z'),
  });
  t.db.update(invoices).set({ status: 'pagada' }).where(eq(invoices.id, august.id)).run();
  insertInvoice(t.db, { clientId: client.id, period: '2026-10', number: 3, totalCents: 1_500_000 });
  return { t, client, september, error };
}

const errorRow = (t: TestApp, id: number) =>
  t.db.select().from(processErrors).where(eq(processErrors.id, id)).get();
const reminders = (t: TestApp) => t.db.select().from(sentEmails).where(eq(sentEmails.kind, 'recordatorio')).all();

describe('reintento manual de un recordatorio (RF-178, FR-046)', () => {
  it('se arma con las facturas adeudadas y la deuda vigente al momento del reintento y resuelve el error', async () => {
    const { t, client, error } = failedReminder();
    const { agent, user } = await loggedInAgent(t, { role: 'editor' });

    const res = await agent.post(`/api/review/errors/${error.id}/retry`);

    expect(res.status).toBe(200);
    const [email] = t.adapters.mailSender.sent;
    const text = (email?.text ?? '').replace(/\s+/g, ' ');
    expect(email?.to).toBe('pagos@losandes.com');
    expect(text).not.toContain('00001-00000001'); // agosto ya está pagada
    expect(text).toContain('00001-00000002');
    expect(text).toContain('00001-00000003');
    expect(text).toMatch(/total a pagar: \$ 27\.000,00/i);
    expect(reminders(t)).toEqual([
      expect.objectContaining({
        clientId: client.id,
        trigger: 'reintento_manual',
        sentByUserId: user.id,
        sentAt: NOW,
      }),
    ]);
    expect(errorRow(t, error.id)).toMatchObject({ status: 'resuelto', resolvedBy: 'reintento_manual' });
  });

  it('si el cliente ya no tiene deuda vigente, bloquea el envío con un mensaje y el error sigue Pendiente', async () => {
    const { t, client, error } = failedReminder();
    t.db.update(invoices).set({ status: 'pagada' }).where(eq(invoices.clientId, client.id)).run();
    const { agent } = await loggedInAgent(t, { role: 'admin' });

    const res = await agent.post(`/api/review/errors/${error.id}/retry`);

    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'sin_deuda',
      message: expect.stringMatching(/no tiene deuda pendiente/i),
    });
    expect(t.adapters.mailSender.attempts).toHaveLength(0);
    expect(errorRow(t, error.id)).toMatchObject({ status: 'pendiente', attempts: 4 });
  });

  it('si el cliente está en revisión, bloquea el envío con un mensaje y el error sigue Pendiente', async () => {
    const { t, september, error } = failedReminder();
    t.db.update(invoices).set({ status: 'revision_manual' }).where(eq(invoices.id, september.id)).run();
    const { agent } = await loggedInAgent(t, { role: 'admin' });

    const res = await agent.post(`/api/review/errors/${error.id}/retry`);

    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'en_revision', message: expect.stringMatching(/revisión manual/i) });
    expect(t.adapters.mailSender.attempts).toHaveLength(0);
    expect(errorRow(t, error.id)?.status).toBe('pendiente');
  });

  it('si el cliente está Inactivo, bloquea el envío con un mensaje y el error sigue Pendiente', async () => {
    const { t, client, error } = failedReminder();
    t.db.update(clients).set({ status: 'inactivo' }).where(eq(clients.id, client.id)).run();
    const { agent } = await loggedInAgent(t, { role: 'admin' });

    const res = await agent.post(`/api/review/errors/${error.id}/retry`);

    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'cliente_inactivo', message: expect.stringMatching(/Inactivo/) });
    expect(t.adapters.mailSender.attempts).toHaveLength(0);
    expect(errorRow(t, error.id)?.status).toBe('pendiente');
  });

  it('si el envío vuelve a fallar, el error sigue Pendiente con el nuevo mensaje y no se registra el recordatorio', async () => {
    const { t, error } = failedReminder();
    t.adapters.mailSender.steps.push(new Error('Gmail sigue rechazando'));
    const { agent } = await loggedInAgent(t, { role: 'editor' });

    const res = await agent.post(`/api/review/errors/${error.id}/retry`);

    expect(res.status).toBe(502);
    expect(t.adapters.mailSender.attempts).toHaveLength(1);
    expect(reminders(t)).toHaveLength(0);
    expect(errorRow(t, error.id)).toMatchObject({
      status: 'pendiente',
      attempts: 5,
      lastErrorMessage: expect.stringContaining('Gmail sigue rechazando'),
    });
  });
});
