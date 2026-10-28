import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { invoices, invoiceStatusChanges } from '../../src/db/schema.ts';
import { createTestApp, loggedInAgent, type TestApp } from '../helpers/test-app.ts';
import { insertClient, insertInvoice } from '../helpers/test-db.ts';

const invoiceById = (t: TestApp, id: number) => t.db.select().from(invoices).where(eq(invoices.id, id)).get();

describe('cambio de estado con el estado desactualizado (RF-218, research R-14)', () => {
  it('AC-240: si el agente pasó la factura a Revisión manual mientras el Editor la miraba en Pago recibido, la acción se rechaza con el estado vigente', async () => {
    const t = createTestApp();
    const client = insertClient(t.db);
    const invoice = insertInvoice(t.db, { clientId: client.id, period: '2026-10', status: 'pago_recibido' });
    const { agent } = await loggedInAgent(t, { role: 'editor' });

    // El agente procesa un comprobante nuevo entre que el Editor abrió la pantalla y confirma.
    t.db
      .update(invoices)
      .set({ status: 'revision_manual', manualReviewReason: 'revisión manual pendiente' })
      .where(eq(invoices.id, invoice.id))
      .run();

    const res = await agent.post(`/api/invoices/${invoice.id}/status`).send({ to: 'pagada', expectedStatus: 'pago_recibido' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('estado_cambiado');
    expect(res.body.error.details).toEqual({ currentStatus: 'revision_manual' });
    expect(res.body.error.message).toMatch(/cambi/i);

    expect(invoiceById(t, invoice.id)).toMatchObject({ status: 'revision_manual', manualReviewReason: 'revisión manual pendiente' });
    expect(t.db.select().from(invoiceStatusChanges).all()).toEqual([]);
  });

  it('si otro usuario ya decidió, el segundo recibe 409 y la decisión del primero se conserva', async () => {
    const t = createTestApp();
    const client = insertClient(t.db);
    const invoice = insertInvoice(t.db, { clientId: client.id, period: '2026-10', status: 'pago_recibido' });
    const first = await loggedInAgent(t, { role: 'editor' });
    const second = await loggedInAgent(t, { role: 'admin' });

    const body = { expectedStatus: 'pago_recibido' };
    expect((await first.agent.post(`/api/invoices/${invoice.id}/status`).send({ ...body, to: 'pagada' })).status).toBe(200);
    const res = await second.agent.post(`/api/invoices/${invoice.id}/status`).send({ ...body, to: 'pendiente_de_pago' });

    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ currentStatus: 'pagada' });
    expect(invoiceById(t, invoice.id)?.status).toBe('pagada');
    expect(t.db.select().from(invoiceStatusChanges).all()).toHaveLength(1);
  });

  it('expectedStatus es obligatorio', async () => {
    const t = createTestApp();
    const client = insertClient(t.db);
    const invoice = insertInvoice(t.db, { clientId: client.id, period: '2026-10', status: 'pago_recibido' });
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    expect((await agent.post(`/api/invoices/${invoice.id}/status`).send({ to: 'pagada' })).status).toBe(400);
    expect(invoiceById(t, invoice.id)?.status).toBe('pago_recibido');
  });
});
