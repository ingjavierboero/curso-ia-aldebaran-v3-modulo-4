import { describe, expect, it, vi } from 'vitest';
import type { IncomingEmail } from '../../src/adapters/types.ts';
import { invoices, settings } from '../../src/db/schema.ts';
import { createRemindersJob } from '../../src/jobs/reminders-job.ts';
import { createScheduler } from '../../src/jobs/scheduler.ts';
import { runBilling } from '../../src/services/billing.ts';
import { processEmails } from '../../src/services/payment-processing.ts';
import { agent as anonymous, createTestApp, loggedInAgent } from '../helpers/test-app.ts';
import { configureIssuer, insertProduct } from '../helpers/test-db.ts';

/** 31/10/2026 (último día del mes) a la hora indicada, en UTC (Argentina es UTC-3). */
const oct31 = (time: string) => `2026-10-31T${time}:00.000Z`;

interface HistoryEvent {
  type: string;
  occurredAt: string;
  actor: { type: 'agente' | 'usuario'; userId: number | null; userName: string | null };
  payload: Record<string, unknown>;
}

/**
 * Recorre todo lo que le pasa a un cliente en un día, con las mismas acciones que en el sistema real
 * (AC-170). Todo ocurre dentro de las 24 h de las sesiones.
 */
async function clientLifecycle() {
  const t = createTestApp({ now: oct31('12:00') });
  configureIssuer(t.db);
  const product = insertProduct(t.db, { name: 'Abono mensual', priceCents: 1_500_000 });
  const { agent: editor } = await loggedInAgent(t, { role: 'editor', name: 'Editora' });
  const { agent: consulta } = await loggedInAgent(t, { role: 'consulta', name: 'Consultor' });
  const at = (time: string) => t.adapters.clock.set(oct31(time));

  at('12:00');
  const created = await editor.post('/api/clients').send({
    businessName: 'Los Andes',
    cuit: '30711111111',
    address: 'Av. Siempre Viva 742',
    billingEmail: 'pagos@losandes.com',
    ivaCondition: 6,
  });
  const clientId = created.body.id as number;
  at('12:05');
  await editor.patch(`/api/clients/${clientId}`).send({ businessName: 'Los Andes SA' });
  at('12:10');
  await editor.put(`/api/clients/${clientId}/products`).send({ productIds: [product.id] });

  // La facturación genera y envía la factura del período.
  at('12:15');
  await runBilling(t.ctx, { period: '2026-10', triggeredBy: 'facturar_ahora' });

  // El recordatorio automático de fin de mes falla, sin reintentos: queda el error de proceso.
  t.db.update(settings).set({ retryCount: 0 }).run();
  t.adapters.mailSender.steps.push(new Error('Gmail rechazó el envío'));
  const scheduler = createScheduler({
    enabled: true,
    clock: t.adapters.clock,
    processes: [createRemindersJob(t.ctx)],
    schedule: vi.fn(),
  });
  at('14:00');
  await scheduler.tick();

  at('14:30');
  await consulta.post(`/api/clients/${clientId}/reminder`);

  // El cliente responde con el comprobante: la factura pasa a Pago recibido.
  at('15:00');
  t.adapters.classifier.fallback = { kind: 'si', cuit: '30711111111', amountRaw: '15000' };
  const reply: IncomingEmail = {
    messageId: '<pago@losandes.com>',
    from: 'pagos@losandes.com',
    subject: 'Pago octubre',
    bodyText: 'Adjunto el comprobante.',
    receivedAt: new Date(oct31('14:55')),
    attachments: [
      {
        filename: 'comprobante.pdf',
        mimeType: 'application/pdf',
        content: new TextEncoder().encode('%PDF-1.4'),
        inline: false,
      },
    ],
  };
  await processEmails(t.ctx, [reply]);

  at('15:30');
  const [invoice] = t.db.select().from(invoices).all();
  await editor
    .post(`/api/invoices/${invoice!.id}/status`)
    .send({ to: 'pagada', expectedStatus: 'pago_recibido' });

  at('16:00');
  await editor.post(`/api/clients/${clientId}/deactivate`);
  at('16:05');
  await editor.post(`/api/clients/${clientId}/reactivate`);

  return { t, clientId, consulta, editor };
}

describe('historial del cliente (RF-163)', () => {
  it('AC-170: muestra cada evento en orden cronológico, con su fecha y hora y el usuario o el agente que lo originó', async () => {
    const { clientId, consulta } = await clientLifecycle();

    const res = await consulta.get(`/api/clients/${clientId}/history`);

    expect(res.status).toBe(200);
    const events = res.body as HistoryEvent[];
    const summary = events.map((e) => [e.type, e.occurredAt, e.actor.type, e.actor.userName]);
    expect(summary).toEqual([
      ['alta', oct31('12:00'), 'usuario', 'Editora'],
      ['modificacion', oct31('12:05'), 'usuario', 'Editora'],
      ['producto_asignado', oct31('12:10'), 'usuario', 'Editora'],
      ['factura_generada', oct31('12:15'), 'agente', null],
      ['email_enviado', oct31('12:15'), 'agente', null],
      ['error_proceso', oct31('14:00'), 'agente', null],
      ['email_enviado', oct31('14:30'), 'usuario', 'Consultor'],
      ['email_recibido', oct31('15:00'), 'agente', null],
      ['estado_factura', oct31('15:00'), 'agente', null],
      ['estado_factura', oct31('15:30'), 'usuario', 'Editora'],
      ['baja', oct31('16:00'), 'usuario', 'Editora'],
      ['reactivacion', oct31('16:05'), 'usuario', 'Editora'],
    ]);
    expect(events[1]?.payload).toMatchObject({ changes: { businessName: 'Los Andes SA' } });
    expect(events[5]?.payload).toMatchObject({ operation: 'envio_recordatorio' });
    expect(events[6]?.payload).toMatchObject({ kind: 'recordatorio', trigger: 'manual' });
    expect(events[8]?.payload).toMatchObject({ from: 'pendiente_de_pago', to: 'pago_recibido' });
    expect(events[9]?.payload).toMatchObject({ from: 'pago_recibido', to: 'pagada' });
  });

  it('AC-12: un Editor o un usuario Consulta ven el nombre del usuario que envió un recordatorio manual', async () => {
    const { clientId, consulta, editor } = await clientLifecycle();
    for (const viewer of [editor, consulta]) {
      const events = (await viewer.get(`/api/clients/${clientId}/history`)).body as HistoryEvent[];
      const manual = events.find((e) => e.type === 'email_enviado' && e.payload.trigger === 'manual');
      expect(manual?.actor).toMatchObject({ type: 'usuario', userName: 'Consultor' });
    }
  });

  it('un cliente inexistente da 404 y sin sesión no se ve el historial', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'consulta' });
    expect((await agent.get('/api/clients/999/history')).status).toBe(404);
    expect((await anonymous(t).get('/api/clients/1/history')).status).toBe(401);
  });
});
