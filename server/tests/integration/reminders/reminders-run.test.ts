import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { clientEvents, reminderRuns, sentEmails, settings, simulatedEmails } from '../../../src/db/schema.ts';
import { HOMOLOGATION_NOTICE, MOCK_NOTICE } from '../../../src/documents/invoice-pdf.ts';
import { createRemindersJob } from '../../../src/jobs/reminders-job.ts';
import { createScheduler } from '../../../src/jobs/scheduler.ts';
import { createMockTestApp, createTestApp, type TestApp } from '../../helpers/test-app.ts';
import { assignProduct, configureIssuer, insertClient, insertInvoice, insertProduct } from '../../helpers/test-db.ts';

/** Argentina es UTC-3 todo el año: las 11:00 de Argentina son las 14:00 UTC. */
const utc = (iso: string) => `${iso}:00.000Z`;

/** Texto del email con espacios normales (Intl usa un espacio duro después de "$"). */
const flat = (text: string) => text.replace(/\s+/g, ' ');

type AnyApp = Pick<TestApp, 'db' | 'ctx'> & { adapters: { clock: TestApp['adapters']['clock'] } };

/** Agente de recordatorios en el scheduler, con el reloj de la app. */
function withScheduler<T extends AnyApp>(t: T) {
  const scheduler = createScheduler({
    enabled: true,
    clock: t.adapters.clock,
    processes: [createRemindersJob(t.ctx)],
    schedule: vi.fn(),
  });
  /** Mueve el reloj y ejecuta el tick de ese minuto. */
  const tickAt = async (iso: string) => {
    t.adapters.clock.set(iso);
    await scheduler.tick();
  };
  return { ...t, tickAt };
}

/** Sistema con un cliente con deuda (agosto $10.000 y septiembre $12.000 en Pendiente de pago). */
function setup(start = utc('2026-10-30T14:00')) {
  const t = withScheduler(createTestApp({ now: start }));
  configureIssuer(t.db);
  const debtor = insertClient(t.db, { billingEmail: 'pagos@losandes.com', businessName: 'Los Andes SRL' });
  assignProduct(t.db, debtor.id, insertProduct(t.db).id);
  insertInvoice(t.db, { clientId: debtor.id, period: '2026-08', number: 1, totalCents: 1_000_000 });
  insertInvoice(t.db, { clientId: debtor.id, period: '2026-09', number: 2, totalCents: 1_200_000 });
  return { t, debtor };
}

const reminders = (t: Pick<TestApp, 'db'>) =>
  t.db.select().from(sentEmails).where(eq(sentEmails.kind, 'recordatorio')).all();
const remindersTo = (t: TestApp) => t.adapters.mailSender.sent.map((email) => email.to).sort();

describe('arranque del proceso de recordatorios (RF-149, RF-152)', () => {
  it('AC-157: se inicia el último día del mes a las 11:00 de Argentina, y no un minuto antes ni otro día', async () => {
    const { t } = setup();
    await t.tickAt(utc('2026-10-30T14:00')); // anteúltimo día
    await t.tickAt(utc('2026-10-31T13:59')); // 10:59 del último día
    expect(t.adapters.mailSender.sent).toHaveLength(0);

    await t.tickAt(utc('2026-10-31T14:00'));
    expect(remindersTo(t)).toEqual(['pagos@losandes.com']);
  });

  it('AC-157: si el tick llega un minuto tarde, igual se inicia', async () => {
    const { t } = setup();
    await t.tickAt(utc('2026-10-31T14:01'));
    expect(t.adapters.mailSender.sent).toHaveLength(1);
  });

  it('AC-159: con la hora de recordatorios en 14:00, se inicia a las 14:00 de Argentina', async () => {
    const { t } = setup();
    t.db.update(settings).set({ remindersTime: '14:00' }).run();
    await t.tickAt(utc('2026-10-31T14:00'));
    await t.tickAt(utc('2026-10-31T16:59'));
    expect(t.adapters.mailSender.sent).toHaveLength(0);

    await t.tickAt(utc('2026-10-31T17:00'));
    expect(t.adapters.mailSender.sent).toHaveLength(1);
  });

  it('también corre el último día de un mes de 30 días', async () => {
    const { t } = setup(utc('2026-11-29T14:00'));
    await t.tickAt(utc('2026-11-30T14:00'));
    expect(t.adapters.mailSender.sent).toHaveLength(1);
  });

  it('AC-154: el proceso se ejecuta una sola vez: cada cliente recibe un único recordatorio aunque el tick siga', async () => {
    const { t } = setup();
    await t.tickAt(utc('2026-10-31T14:00'));
    await t.tickAt(utc('2026-10-31T14:01'));
    await t.tickAt(utc('2026-10-31T20:00'));
    expect(t.adapters.mailSender.sent).toHaveLength(1);
    expect(reminders(t)).toHaveLength(1);
  });
});

describe('a quién se le envía el recordatorio (RF-149, RF-155, RF-96)', () => {
  it('AC-154, AC-155, AC-156, AC-162, AC-88: solo a los clientes Activos con deuda vigente que no están en revisión', async () => {
    const { t } = setup();
    // AC-155: sin productos asignados, con una factura Pendiente de pago.
    const noProducts = insertClient(t.db, { billingEmail: 'sinproductos@clientes.com' });
    insertInvoice(t.db, { clientId: noProducts.id, period: '2026-10', number: 3 });
    // AC-156: en revisión (una factura en Revisión manual y otra Pendiente de pago).
    const inReview = insertClient(t.db, { billingEmail: 'revision@clientes.com' });
    insertInvoice(t.db, { clientId: inReview.id, period: '2026-09', number: 4, status: 'revision_manual' });
    insertInvoice(t.db, { clientId: inReview.id, period: '2026-10', number: 5 });
    // AC-162: todas sus facturas en Pago recibido o Pagada.
    const noDebt = insertClient(t.db, { billingEmail: 'aldia@clientes.com' });
    insertInvoice(t.db, { clientId: noDebt.id, period: '2026-09', number: 6, status: 'pagada' });
    insertInvoice(t.db, { clientId: noDebt.id, period: '2026-10', number: 7, status: 'pago_recibido' });
    // AC-88: Inactivo con facturas adeudadas.
    const inactive = insertClient(t.db, { billingEmail: 'inactivo@clientes.com', status: 'inactivo' });
    insertInvoice(t.db, { clientId: inactive.id, period: '2026-10', number: 8 });

    await t.tickAt(utc('2026-10-31T14:00'));

    expect(remindersTo(t)).toEqual(['pagos@losandes.com', 'sinproductos@clientes.com']);
  });

  it('AC-154: el envío queda registrado en el historial del cliente, como acción del agente', async () => {
    const { t, debtor } = setup();
    await t.tickAt(utc('2026-10-31T14:00'));

    expect(reminders(t)).toEqual([
      expect.objectContaining({
        clientId: debtor.id,
        trigger: 'automatico',
        reminderMonth: '2026-10',
        toAddress: 'pagos@losandes.com',
        sentAt: '2026-10-31T14:00:00.000Z',
        sentByUserId: null,
      }),
    ]);
    const events = t.db
      .select()
      .from(clientEvents)
      .where(and(eq(clientEvents.clientId, debtor.id), eq(clientEvents.type, 'email_enviado')))
      .all();
    expect(events).toEqual([
      expect.objectContaining({
        actorType: 'agente',
        payload: expect.objectContaining({ kind: 'recordatorio', trigger: 'automatico', to: 'pagos@losandes.com' }),
      }),
    ]);
  });
});

describe('contenido del recordatorio (RF-150, RF-151, RF-210)', () => {
  it('AC-158: detalla cada factura adeudada con número, período, importe y vencimiento, el total y pide el comprobante', async () => {
    const { t } = setup();
    await t.tickAt(utc('2026-10-31T14:00'));

    const [email] = t.adapters.mailSender.sent;
    const text = flat(email!.text);
    expect(email!.to).toBe('pagos@losandes.com');
    expect(email!.subject).toMatch(/recordatorio/i);
    for (const [number, period, amount, due] of [
      ['00001-00000001', 'agosto de 2026', '$ 10.000,00', '31/08/2026'],
      ['00001-00000002', 'septiembre de 2026', '$ 12.000,00', '30/09/2026'],
    ]) {
      expect(text).toContain(number);
      expect(text).toContain(period);
      expect(text).toContain(amount);
      expect(text).toContain(due);
    }
    expect(text).toMatch(/total a pagar.*\$ 22\.000,00/i);
    expect(text).toMatch(/respond.*adjuntando el comprobante de pago/i);
    expect(text).not.toMatch(/modo mock/i);
  });

  it('el remitente es el nombre de fantasía de la empresa emisora o, si no tiene, su razón social (RF-215)', async () => {
    const { t } = setup();
    t.db.update(settings).set({ issuerTradeName: 'Estudio Molina' }).run();
    await t.tickAt(utc('2026-10-31T14:00'));
    expect(t.adapters.mailSender.sent[0]?.fromName).toBe('Estudio Molina');
  });

  it('AC-207: en modo mock el recordatorio indica que es simulado y no lleva la leyenda de homologación', async () => {
    const t = withScheduler(createMockTestApp({ now: utc('2026-10-31T13:00') }));
    configureIssuer(t.db);
    const client = insertClient(t.db, { billingEmail: 'pagos@losandes.com' });
    insertInvoice(t.db, { clientId: client.id, period: '2026-10', number: 1 });

    await t.tickAt(utc('2026-10-31T14:00'));

    const [email] = t.db.select().from(simulatedEmails).where(eq(simulatedEmails.direction, 'enviado')).all();
    expect(flat(email?.body ?? '')).toContain(MOCK_NOTICE);
    expect(flat(email?.body ?? '')).not.toContain(HOMOLOGATION_NOTICE);
    expect(reminders(t)).toHaveLength(1);
  });
});

describe('recuperación de un proceso interrumpido (RF-149)', () => {
  /** Proceso de octubre que arrancó y se cortó después de enviarle el recordatorio a Los Andes. */
  function interrupted() {
    const { t, debtor } = setup();
    const other = insertClient(t.db, { billingEmail: 'otro@clientes.com' });
    insertInvoice(t.db, { clientId: other.id, period: '2026-10', number: 9 });
    t.db.insert(reminderRuns).values({ month: '2026-10', startedAt: '2026-10-31T14:00:00.000Z' }).run();
    t.db.insert(sentEmails)
      .values({
        kind: 'recordatorio',
        trigger: 'automatico',
        clientId: debtor.id,
        reminderMonth: '2026-10',
        toAddress: 'pagos@losandes.com',
        subject: 'Recordatorio',
        body: 'Recordatorio',
        sentAt: '2026-10-31T14:00:00.000Z',
      })
      .run();
    return t;
  }

  it('AC-246: si vuelve a funcionar ese mismo día, envía el recordatorio solo a los clientes que faltan', async () => {
    const t = interrupted();
    await t.tickAt(utc('2026-10-31T18:30'));

    expect(remindersTo(t)).toEqual(['otro@clientes.com']);
    expect(t.db.select().from(reminderRuns).get()?.finishedAt).toBe('2026-10-31T18:30:00.000Z');
  });

  it('AC-246: si vuelve a funcionar al día siguiente, no envía ninguno', async () => {
    const t = interrupted();
    await t.tickAt(utc('2026-11-01T14:00'));
    await t.tickAt(utc('2026-11-01T18:00'));

    expect(t.adapters.mailSender.sent).toHaveLength(0);
  });

  it('un recordatorio manual enviado ese día no evita el automático (cuentan solo los de la corrida del mes)', async () => {
    const { t, debtor } = setup();
    t.db.insert(sentEmails)
      .values({
        kind: 'recordatorio',
        trigger: 'manual',
        clientId: debtor.id,
        toAddress: 'pagos@losandes.com',
        subject: 'Recordatorio',
        body: 'Recordatorio',
        sentAt: '2026-10-31T12:00:00.000Z',
      })
      .run();

    await t.tickAt(utc('2026-10-31T14:00'));
    expect(t.adapters.mailSender.sent).toHaveLength(1);
  });
});
