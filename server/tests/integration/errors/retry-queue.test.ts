/**
 * Reintentos automáticos persistidos (RF-171 a RF-174, research R-11): el primer intento corre en línea;
 * si falla, la operación se encola con la espera configurada y el proceso sigue con los demás clientes.
 * Al agotar los reintentos queda un error de proceso Pendiente.
 */
import { and, asc, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { ArcaRejectionError } from '../../../src/adapters/types.ts';
import {
  clientEvents,
  invoices,
  processErrors,
  retryQueue,
  sentEmails,
  settings,
} from '../../../src/db/schema.ts';
import { createBillingJob } from '../../../src/jobs/billing-job.ts';
import { createRemindersJob } from '../../../src/jobs/reminders-job.ts';
import { createRetryQueueJob } from '../../../src/jobs/retry-queue.ts';
import { createScheduler } from '../../../src/jobs/scheduler.ts';
import { timeout } from '../../helpers/fakes.ts';
import { createTestApp, type TestApp } from '../../helpers/test-app.ts';
import { assignProduct, configureIssuer, insertClient, insertInvoice, insertProduct } from '../../helpers/test-db.ts';

/** Argentina es UTC-3 todo el año: las 11:00 de Argentina son las 14:00 UTC. */
const utc = (iso: string) => `${iso}:00.000Z`;

/** Agentes de facturación, recordatorios y reintentos en un scheduler, como en `index.ts`. */
function withAgents(t: TestApp) {
  const scheduler = createScheduler({
    enabled: true,
    clock: t.adapters.clock,
    processes: [createBillingJob(t.ctx), createRemindersJob(t.ctx), createRetryQueueJob(t.ctx)],
    schedule: vi.fn(),
  });
  /** Mueve el reloj y ejecuta el tick de ese minuto. */
  const tickAt = async (iso: string) => {
    t.adapters.clock.set(iso);
    await scheduler.tick();
  };
  return tickAt;
}

/** Sistema el 15 de octubre a las 10:00 con un cliente facturable. */
function setup(start = utc('2026-10-15T13:00')) {
  const t = createTestApp({ now: start });
  configureIssuer(t.db);
  const client = insertClient(t.db, { ivaCondition: 6, billingEmail: 'pagos@losandes.com' });
  assignProduct(t.db, client.id, insertProduct(t.db).id);
  return { t, client, tickAt: withAgents(t) };
}

const invoiceOf = (t: TestApp, clientId: number) =>
  t.db.select().from(invoices).where(eq(invoices.clientId, clientId)).get();
const errors = (t: TestApp) => t.db.select().from(processErrors).orderBy(asc(processErrors.id)).all();
const queue = (t: TestApp) => t.db.select().from(retryQueue).all();
const invoiceEmailsTo = (t: TestApp, to: string) =>
  t.adapters.mailSender.sent.filter((email) => email.to === to && /^Factura C/.test(email.subject));
const fail = (message = 'Gmail rechazó el envío') => new Error(message);

describe('reintento de la generación de una factura (RF-171, RF-174)', () => {
  it('AC-178: con la configuración por defecto, el segundo intento ocurre 5 minutos después y la factura queda generada sin error', async () => {
    const { t, client, tickAt } = setup();
    t.adapters.arca.caeSteps.push(timeout('WSFEv1'));

    await tickAt(utc('2026-10-15T14:00'));
    expect(t.adapters.arca.requests).toHaveLength(1);
    expect(queue(t)).toEqual([
      expect.objectContaining({
        operation: 'generacion_factura',
        clientId: client.id,
        period: '2026-10',
        attempt: 1,
        nextAttemptAt: '2026-10-15T14:05:00.000Z',
      }),
    ]);

    await tickAt(utc('2026-10-15T14:04'));
    expect(t.adapters.arca.requests).toHaveLength(1);

    await tickAt(utc('2026-10-15T14:05'));
    expect(t.adapters.arca.requests).toHaveLength(2);
    expect(invoiceOf(t, client.id)?.status).toBe('pendiente_de_pago');
    expect(invoiceEmailsTo(t, 'pagos@losandes.com')).toHaveLength(1);
    expect(queue(t)).toHaveLength(0);
    expect(errors(t)).toHaveLength(0);
  });

  it('AC-179: si ARCA nunca responde, hace 4 intentos, no envía email y registra el error con cliente, período, intentos y último mensaje', async () => {
    const { t, client, tickAt } = setup();
    for (let i = 0; i < 4; i++) t.adapters.arca.caeSteps.push(timeout('WSFEv1'));

    for (const minute of ['14:00', '14:05', '14:10', '14:15']) await tickAt(utc(`2026-10-15T${minute}`));

    expect(t.adapters.arca.requests).toHaveLength(4);
    expect(invoiceEmailsTo(t, 'pagos@losandes.com')).toHaveLength(0);
    expect(invoiceOf(t, client.id)?.cae).toBeNull();
    expect(queue(t)).toHaveLength(0);
    expect(errors(t)).toEqual([
      expect.objectContaining({
        operation: 'generacion_factura',
        status: 'pendiente',
        clientId: client.id,
        period: '2026-10',
        attempts: 4,
        lastErrorMessage: 'WSFEv1 no respondió a tiempo',
      }),
    ]);

    await tickAt(utc('2026-10-15T14:30'));
    expect(t.adapters.arca.requests).toHaveLength(4);
  });

  it('AC-247: un rechazo de validación de ARCA no se reintenta: un único intento y el error con el mensaje de ARCA', async () => {
    const { t, client, tickAt } = setup();
    t.adapters.arca.caeSteps.push(new ArcaRejectionError('10016: el CUIT receptor no es válido'));

    await tickAt(utc('2026-10-15T14:00'));
    await tickAt(utc('2026-10-15T14:05'));

    expect(t.adapters.arca.requests).toHaveLength(1);
    expect(queue(t)).toHaveLength(0);
    expect(errors(t)).toEqual([
      expect.objectContaining({
        operation: 'generacion_factura',
        clientId: client.id,
        attempts: 1,
        lastErrorMessage: '10016: el CUIT receptor no es válido',
      }),
    ]);
  });

  it('AC-79: el email del segundo cliente sale sin esperar el reintento del primero, y el del primero apenas se genera', async () => {
    const { t, client, tickAt } = setup();
    const second = insertClient(t.db, { ivaCondition: 6, billingEmail: 'pagos@segundo.com' });
    assignProduct(t.db, second.id, insertProduct(t.db).id);
    t.adapters.arca.caeSteps.push(timeout('WSFEv1'));

    await tickAt(utc('2026-10-15T14:00'));
    expect(invoiceEmailsTo(t, 'pagos@segundo.com')).toHaveLength(1);
    expect(invoiceEmailsTo(t, 'pagos@losandes.com')).toHaveLength(0);

    await tickAt(utc('2026-10-15T14:05'));
    expect(invoiceOf(t, client.id)?.status).toBe('pendiente_de_pago');
    expect(invoiceEmailsTo(t, 'pagos@losandes.com')).toHaveLength(1);
  });

  it('en cada reintento usa los datos vigentes: el precio cambiado entre intentos va a la factura', async () => {
    const { t, client, tickAt } = setup();
    t.adapters.arca.caeSteps.push(timeout('WSFEv1'));
    await tickAt(utc('2026-10-15T14:00'));

    const otherProduct = insertProduct(t.db, { priceCents: 2_500_000 });
    assignProduct(t.db, client.id, otherProduct.id);
    await tickAt(utc('2026-10-15T14:05'));

    expect(invoiceOf(t, client.id)?.totalCents).toBe(3_500_000);
  });
});

describe('reintento del envío de una factura (RF-86, RF-171)', () => {
  it('AC-80: si el primer envío falla y el segundo no, se envía el email y en ARCA queda un único comprobante', async () => {
    const { t, client, tickAt } = setup();
    t.adapters.mailSender.steps.push(fail());

    await tickAt(utc('2026-10-15T14:00'));
    expect(queue(t)).toEqual([expect.objectContaining({ operation: 'envio_factura', attempt: 1 })]);

    await tickAt(utc('2026-10-15T14:05'));
    expect(invoiceEmailsTo(t, 'pagos@losandes.com')).toHaveLength(1);
    expect(t.adapters.arca.requests).toHaveLength(1);
    expect(t.adapters.arca.vouchers.size).toBe(1);
    expect(invoiceOf(t, client.id)?.status).toBe('pendiente_de_pago');
    expect(errors(t)).toHaveLength(0);
  });

  it('AC-180: si el email se rechaza siempre, hace 4 intentos, la factura queda Pendiente de pago y se registra el error', async () => {
    const { t, client, tickAt } = setup();
    for (let i = 0; i < 4; i++) t.adapters.mailSender.steps.push(fail());

    for (const minute of ['14:00', '14:05', '14:10', '14:15']) await tickAt(utc(`2026-10-15T${minute}`));

    expect(t.adapters.mailSender.attempts).toHaveLength(4);
    expect(t.adapters.arca.requests).toHaveLength(1);
    const invoice = invoiceOf(t, client.id);
    expect(invoice?.status).toBe('pendiente_de_pago');
    expect(errors(t)).toEqual([
      expect.objectContaining({
        operation: 'envio_factura',
        clientId: client.id,
        period: '2026-10',
        invoiceId: invoice?.id,
        attempts: 4,
        lastErrorMessage: 'Gmail rechazó el envío',
      }),
    ]);
  });
});

describe('reintento del recordatorio automático (RF-171, RF-174)', () => {
  /** Cliente con deuda el último día de octubre, una hora antes de los recordatorios. */
  function reminderSetup() {
    const t = createTestApp({ now: utc('2026-10-31T13:00') });
    configureIssuer(t.db);
    const client = insertClient(t.db, { billingEmail: 'pagos@losandes.com' });
    const invoice = insertInvoice(t.db, { clientId: client.id, period: '2026-10', number: 1 });
    return { t, client, invoice, tickAt: withAgents(t) };
  }

  it('AC-181: si el email se rechaza siempre, hace 4 intentos y registra el error de envío de recordatorio', async () => {
    const { t, client, tickAt } = reminderSetup();
    for (let i = 0; i < 4; i++) t.adapters.mailSender.steps.push(fail());

    for (const minute of ['14:00', '14:05', '14:10', '14:15']) await tickAt(utc(`2026-10-31T${minute}`));

    expect(t.adapters.mailSender.attempts).toHaveLength(4);
    expect(errors(t)).toEqual([
      expect.objectContaining({
        operation: 'envio_recordatorio',
        clientId: client.id,
        period: '2026-10',
        attempts: 4,
        lastErrorMessage: expect.stringContaining('Gmail rechazó el envío'),
      }),
    ]);
  });

  it('un recordatorio que falla una vez se envía en el reintento y queda como parte de la corrida del mes', async () => {
    const { t, tickAt } = reminderSetup();
    t.adapters.mailSender.steps.push(fail());

    await tickAt(utc('2026-10-31T14:00'));
    await tickAt(utc('2026-10-31T14:05'));

    expect(t.adapters.mailSender.sent).toHaveLength(1);
    expect(t.db.select().from(sentEmails).all()).toEqual([
      expect.objectContaining({ kind: 'recordatorio', trigger: 'automatico', reminderMonth: '2026-10' }),
    ]);
    expect(errors(t)).toHaveLength(0);
  });

  it('AC-247: si al reintentar el cliente ya pagó todo, se cancela sin email ni error y queda en su historial', async () => {
    const { t, client, invoice, tickAt } = reminderSetup();
    t.adapters.mailSender.steps.push(fail());
    await tickAt(utc('2026-10-31T14:00'));

    t.db.update(invoices).set({ status: 'pagada' }).where(eq(invoices.id, invoice.id)).run();
    await tickAt(utc('2026-10-31T14:05'));

    expect(t.adapters.mailSender.attempts).toHaveLength(1);
    expect(queue(t)).toHaveLength(0);
    expect(errors(t)).toHaveLength(0);
    const cancelled = t.db
      .select()
      .from(clientEvents)
      .where(and(eq(clientEvents.clientId, client.id), eq(clientEvents.type, 'recordatorio_cancelado')))
      .all();
    expect(cancelled).toEqual([
      expect.objectContaining({
        actorType: 'agente',
        payload: expect.objectContaining({ reason: expect.stringMatching(/no tiene deuda/i) }),
      }),
    ]);
  });
});

describe('configuración de los reintentos (RF-172, RF-173)', () => {
  it('AC-182: con 0 reintentos, hace un solo intento y registra el error', async () => {
    const { t, tickAt } = setup();
    t.db.update(settings).set({ retryCount: 0 }).run();
    t.adapters.arca.caeSteps.push(timeout('WSFEv1'), timeout('WSFEv1'));

    await tickAt(utc('2026-10-15T14:00'));
    await tickAt(utc('2026-10-15T14:05'));

    expect(t.adapters.arca.requests).toHaveLength(1);
    expect(queue(t)).toHaveLength(0);
    expect(errors(t)).toEqual([expect.objectContaining({ operation: 'generacion_factura', attempts: 1 })]);
  });

  it('AC-184: con 10 minutos de espera, el siguiente intento ocurre 10 minutos después', async () => {
    const { t, tickAt } = setup();
    t.db.update(settings).set({ retryWaitMinutes: 10 }).run();
    t.adapters.arca.caeSteps.push(timeout('WSFEv1'));

    await tickAt(utc('2026-10-15T14:00'));
    await tickAt(utc('2026-10-15T14:09'));
    expect(t.adapters.arca.requests).toHaveLength(1);

    await tickAt(utc('2026-10-15T14:10'));
    expect(t.adapters.arca.requests).toHaveLength(2);
  });
});

describe('cola persistida (research R-11)', () => {
  it('después de un reinicio, la cola se retoma con el número de intento guardado', async () => {
    const { t, client, tickAt } = setup();
    for (let i = 0; i < 4; i++) t.adapters.arca.caeSteps.push(timeout('WSFEv1'));
    await tickAt(utc('2026-10-15T14:00'));
    await tickAt(utc('2026-10-15T14:05'));
    expect(queue(t)).toEqual([expect.objectContaining({ attempt: 2 })]);

    // Reinicio: un scheduler nuevo sobre la misma base.
    const restarted = withAgents(t);
    await restarted(utc('2026-10-15T14:10'));
    await restarted(utc('2026-10-15T14:15'));

    expect(t.adapters.arca.requests).toHaveLength(4);
    expect(errors(t)).toEqual([
      expect.objectContaining({ operation: 'generacion_factura', clientId: client.id, attempts: 4 }),
    ]);
  });
});
