import { asc } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { IncomingEmail } from '../../../src/adapters/types.ts';
import { mailboxChecks, processErrors, receivedEmails, settings } from '../../../src/db/schema.ts';
import { createMailboxJob } from '../../../src/jobs/mailbox-job.ts';
import { createScheduler } from '../../../src/jobs/scheduler.ts';
import { timeout } from '../../helpers/fakes.ts';
import { createTestApp, type TestApp } from '../../helpers/test-app.ts';
import { insertClient, insertInvoice } from '../../helpers/test-db.ts';

/** Hora de Argentina (UTC-3) → instante ISO. */
const ar = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`).toISOString();

/** Email del cliente sin adjuntos: solo queda en su historial (RF-114, RF-115). */
const email = (messageId: string, receivedAt: string): IncomingEmail => ({
  messageId,
  from: 'pagos@losandes.com',
  subject: 'Consulta',
  bodyText: 'Hola',
  receivedAt: new Date(receivedAt),
  attachments: [],
});

/** Sistema con un cliente y, salvo que se indique, una factura emitida el 15/10/2026. */
function setup({ withInvoice = true } = {}) {
  const t = createTestApp({ now: ar('2026-10-20', '15:00') });
  const client = insertClient(t.db, { billingEmail: 'pagos@losandes.com' });
  if (withInvoice) insertInvoice(t.db, { clientId: client.id, period: '2026-10', issueDate: '2026-10-15' });
  const scheduler = createScheduler({
    enabled: true,
    clock: t.adapters.clock,
    processes: [createMailboxJob(t.ctx)],
    schedule: vi.fn(),
  });
  const tickAt = async (iso: string) => {
    t.adapters.clock.set(iso);
    await scheduler.tick();
  };
  return { t, client, scheduler, tickAt };
}

const processed = (t: TestApp) =>
  t.db.select({ id: receivedEmails.messageId }).from(receivedEmails).orderBy(asc(receivedEmails.id)).all().map((r) => r.id);
const checks = (t: TestApp) => t.db.select().from(mailboxChecks).orderBy(asc(mailboxChecks.id)).all();
const mailboxErrors = (t: TestApp) => t.db.select().from(processErrors).all();

describe('frecuencia de la revisión (RF-99 a RF-102)', () => {
  it('AC-92: revisa cada 15 minutos desde el inicio de la anterior y registra la revisión con los emails detectados', async () => {
    const { t, tickAt } = setup();
    t.adapters.mailbox.emails.push(email('<a@x>', ar('2026-10-20', '14:50')));

    await tickAt(ar('2026-10-20', '15:00'));
    expect(t.adapters.mailbox.calls).toHaveLength(1);
    await tickAt(ar('2026-10-20', '15:14'));
    expect(t.adapters.mailbox.calls).toHaveLength(1);
    await tickAt(ar('2026-10-20', '15:15'));
    expect(t.adapters.mailbox.calls).toHaveLength(2);

    expect(checks(t)[0]).toMatchObject({ startedAt: ar('2026-10-20', '15:00'), success: true, emailsDetected: 1 });
    expect(processed(t)).toEqual(['<a@x>']);
  });

  it('AC-93: con el intervalo en 5 minutos, la revisión siguiente es 5 minutos después', async () => {
    const { t, tickAt } = setup();
    t.db.update(settings).set({ mailboxIntervalMinutes: 5 }).run();
    await tickAt(ar('2026-10-20', '15:00'));
    await tickAt(ar('2026-10-20', '15:04'));
    expect(t.adapters.mailbox.calls).toHaveLength(1);
    await tickAt(ar('2026-10-20', '15:05'));
    expect(t.adapters.mailbox.calls).toHaveLength(2);
  });

  it('AC-95: si la revisión de las 15:00 sigue en curso a las 15:15, no se inicia otra hasta que termine', async () => {
    const { t, scheduler, tickAt } = setup();
    let release: () => void = () => {};
    t.adapters.mailbox.steps.push(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    t.adapters.clock.set(ar('2026-10-20', '15:00'));
    const first = scheduler.tick();
    await vi.waitFor(() => expect(t.adapters.mailbox.calls).toHaveLength(1));
    await tickAt(ar('2026-10-20', '15:15'));
    expect(t.adapters.mailbox.calls).toHaveLength(1);

    release();
    await first;
    await tickAt(ar('2026-10-20', '15:16'));
    expect(t.adapters.mailbox.calls).toHaveLength(2);
  });
});

describe('fallas de la casilla (RF-103 a RF-106)', () => {
  it('AC-96, AC-97: sin respuesta durante tres intervalos, un intento por intervalo y un único error Pendiente de revisión de la casilla', async () => {
    const { t, tickAt } = setup();
    t.adapters.mailbox.steps.push(timeout('IMAP'), timeout('IMAP'), timeout('IMAP'));

    await tickAt(ar('2026-10-20', '15:00'));
    await tickAt(ar('2026-10-20', '15:15'));
    await tickAt(ar('2026-10-20', '15:30'));

    expect(t.adapters.mailbox.calls).toHaveLength(3);
    expect(mailboxErrors(t)).toEqual([
      expect.objectContaining({ operation: 'revision_casilla', status: 'pendiente', attempts: 3, clientId: null }),
    ]);
    expect(checks(t).map((c) => c.success)).toEqual([false, false, false]);
  });

  it('AC-98: cuando la casilla vuelve, procesa los emails llegados durante la falla y resuelve el error', async () => {
    const { t, tickAt } = setup();
    await tickAt(ar('2026-10-20', '15:00')); // revisión exitosa: la siguiente busca desde las 15:00
    t.adapters.mailbox.steps.push(timeout('IMAP'));
    await tickAt(ar('2026-10-20', '15:15'));
    t.adapters.mailbox.emails.push(email('<falla-1@x>', ar('2026-10-20', '15:20')), email('<falla-2@x>', ar('2026-10-20', '15:25')));

    await tickAt(ar('2026-10-20', '15:30'));

    expect(processed(t)).toEqual(['<falla-1@x>', '<falla-2@x>']);
    expect(mailboxErrors(t)).toEqual([
      expect.objectContaining({ operation: 'revision_casilla', status: 'resuelto', resolvedBy: 'agente' }),
    ]);
  });
});

describe('qué emails se procesan (RF-107 a RF-109)', () => {
  it('AC-99: la primera revisión procesa desde el día de la primera factura; la siguiente, solo los nuevos', async () => {
    const { t, tickAt } = setup();
    t.adapters.mailbox.emails.push(
      email('<antes@x>', ar('2026-10-14', '23:59')),
      email('<ese-dia@x>', ar('2026-10-15', '00:01')),
      email('<despues@x>', ar('2026-10-18', '10:00')),
    );

    await tickAt(ar('2026-10-20', '15:00'));
    expect(processed(t)).toEqual(['<ese-dia@x>', '<despues@x>']);
    expect(t.adapters.mailbox.calls[0]).toEqual(new Date(ar('2026-10-15', '00:00')));

    t.adapters.mailbox.emails.push(email('<nuevo@x>', ar('2026-10-20', '15:05')));
    await tickAt(ar('2026-10-20', '15:15'));
    expect(processed(t)).toEqual(['<ese-dia@x>', '<despues@x>', '<nuevo@x>']);
  });

  it('RF-107: mientras no haya ninguna factura emitida no se revisa la casilla ni se procesa ningún email', async () => {
    const { t, tickAt } = setup({ withInvoice: false });
    t.adapters.mailbox.emails.push(email('<a@x>', ar('2026-10-20', '14:00')));
    await tickAt(ar('2026-10-20', '15:00'));
    await tickAt(ar('2026-10-20', '15:30'));
    expect(t.adapters.mailbox.calls).toHaveLength(0);
    expect(processed(t)).toEqual([]);
  });

  it('RF-107: una factura que todavía se está generando no cuenta como emitida', async () => {
    const { t, client, tickAt } = setup({ withInvoice: false });
    insertInvoice(t.db, { clientId: client.id, period: '2026-10', status: 'generando', number: null });
    await tickAt(ar('2026-10-20', '15:00'));
    expect(t.adapters.mailbox.calls).toHaveLength(0);
  });

  it('RF-109: un email que se vuelve a leer de la casilla no se procesa dos veces', async () => {
    const { t, tickAt } = setup();
    t.adapters.mailbox.emails.push(email('<a@x>', ar('2026-10-20', '14:00')));
    await tickAt(ar('2026-10-20', '15:00'));
    // Una revisión posterior que vuelve a leer el mismo email (por ejemplo, con margen de búsqueda).
    t.adapters.mailbox.emails.push(email('<a@x>', ar('2026-10-20', '15:10')));
    await tickAt(ar('2026-10-20', '15:15'));
    expect(processed(t)).toEqual(['<a@x>']);
  });
});
