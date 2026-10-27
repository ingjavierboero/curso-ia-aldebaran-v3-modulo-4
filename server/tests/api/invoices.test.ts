import { describe, expect, it } from 'vitest';
import { createTestApp, loggedInAgent } from '../helpers/test-app.ts';
import { insertClient, insertInvoice } from '../helpers/test-db.ts';

describe('listado básico de facturas (RF-160)', () => {
  it('cualquier perfil ve las facturas emitidas, de la más reciente a la más antigua, con sus datos', async () => {
    const t = createTestApp();
    const client = insertClient(t.db, { businessName: 'Los Andes SRL' });
    const september = insertInvoice(t.db, { clientId: client.id, period: '2026-09', number: 1, pointOfSale: 3, totalCents: 1_500_000 });
    const october = insertInvoice(t.db, { clientId: client.id, period: '2026-10', number: 2, pointOfSale: 3, totalCents: 2_000_000 });

    for (const role of ['admin', 'editor', 'consulta'] as const) {
      const { agent } = await loggedInAgent(t, { role });
      const res = await agent.get('/api/invoices');
      expect(res.status, role).toBe(200);
      expect(res.body.map((i: { id: number }) => i.id), role).toEqual([october.id, september.id]);
      expect(res.body[0], role).toMatchObject({
        clientId: client.id,
        clientName: 'Los Andes SRL',
        period: '2026-10',
        voucherNumber: '00003-00000002',
        totalCents: 2_000_000,
        status: 'pendiente_de_pago',
      });
    }
  });

  it('no muestra las facturas que todavía están generándose (sin CAE)', async () => {
    const t = createTestApp();
    const client = insertClient(t.db);
    insertInvoice(t.db, { clientId: client.id, period: '2026-10', status: 'generando', number: null, cae: null });
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    expect((await agent.get('/api/invoices')).body).toEqual([]);
  });
});
