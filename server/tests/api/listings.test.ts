import { describe, expect, it } from 'vitest';
import type { IncomingEmail } from '../../src/adapters/types.ts';
import { runBilling } from '../../src/services/billing.ts';
import { processEmails } from '../../src/services/payment-processing.ts';
import { pdfText } from '../helpers/pdf-text.ts';
import { agent as anonymous, createTestApp, loggedInAgent, type TestApp } from '../helpers/test-app.ts';
import {
  assignProduct,
  configureIssuer,
  insertClient,
  insertInvoice,
  insertProduct,
} from '../helpers/test-db.ts';

/** 20/10/2026 a las 10:00 de Argentina. */
const NOW = '2026-10-20T13:00:00.000Z';


describe('listado y detalle de clientes (RF-158, RF-214, RF-169)', () => {
  /** Los Andes SA, Activo con $22.000 de deuda; Taller Sur, Inactivo y sin deuda. */
  function clientsScenario() {
    const t = createTestApp({ now: NOW });
    const andes = insertClient(t.db, {
      businessName: 'Los Andes SA',
      cuit: '30711111111',
      billingEmail: 'pagos@losandes.com',
      ivaCondition: 6,
    });
    insertInvoice(t.db, { clientId: andes.id, period: '2026-08', number: 1, totalCents: 1_000_000 });
    insertInvoice(t.db, {
      clientId: andes.id,
      period: '2026-09',
      number: 2,
      totalCents: 1_200_000,
      status: 'revision_manual',
    });
    insertInvoice(t.db, { clientId: andes.id, period: '2026-07', number: 3, totalCents: 500_000, status: 'pagada' });
    const sur = insertClient(t.db, { businessName: 'Taller Sur', billingEmail: 'pagos@sur.com', status: 'inactivo' });
    return { t, andes, sur };
  }

  it('AC-165: lista los clientes Activos e Inactivos con razón social, CUIT, email, condición frente al IVA, estado y deuda', async () => {
    const { t, andes, sur } = clientsScenario();
    const { agent } = await loggedInAgent(t, { role: 'consulta' });

    const res = await agent.get('/api/clients');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        id: andes.id,
        businessName: 'Los Andes SA',
        cuit: '30711111111',
        billingEmail: 'pagos@losandes.com',
        ivaCondition: 6,
        status: 'activo',
        debtCents: 2_200_000,
      }),
      expect.objectContaining({ id: sur.id, businessName: 'Taller Sur', status: 'inactivo', debtCents: 0 }),
    ]);
  });

  it('AC-176: filtra por estado y busca por razón social o por CUIT, con o sin guiones', async () => {
    const { t, andes, sur } = clientsScenario();
    const { agent } = await loggedInAgent(t, { role: 'consulta' });
    const ids = async (query: string) =>
      (await agent.get(`/api/clients${query}`)).body.map((c: { id: number }) => c.id);

    expect(await ids('?status=inactivo')).toEqual([sur.id]);
    expect(await ids('?status=activo')).toEqual([andes.id]);
    expect(await ids('?q=Andes')).toEqual([andes.id]);
    expect(await ids('?q=andes')).toEqual([andes.id]);
    expect(await ids('?q=30711111111')).toEqual([andes.id]);
    expect(await ids('?q=30-71111111-1')).toEqual([andes.id]);
    expect(await ids('?q=Andes&status=inactivo')).toEqual([]);
  });

  it('rechaza un estado de filtro inválido', async () => {
    const { t } = clientsScenario();
    const { agent } = await loggedInAgent(t, { role: 'consulta' });
    expect((await agent.get('/api/clients?status=borrado')).status).toBe(400);
  });

  it('AC-236: el detalle muestra razón social, CUIT, domicilio, email, condición frente al IVA, estado y fecha de alta', async () => {
    const { t, andes } = clientsScenario();
    const { agent } = await loggedInAgent(t, { role: 'consulta' });

    const res = await agent.get(`/api/clients/${andes.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      businessName: 'Los Andes SA',
      cuit: '30711111111',
      address: andes.address,
      billingEmail: 'pagos@losandes.com',
      ivaCondition: 6,
      status: 'activo',
      createdAt: andes.createdAt,
    });
  });
});

describe('listado de productos (RF-159)', () => {
  it('AC-166: lista los productos Activos e Inactivos con nombre, precio, moneda y estado', async () => {
    const t = createTestApp({ now: NOW });
    insertProduct(t.db, { name: 'Abono mensual', priceCents: 1_500_000, currency: 'ARS' });
    insertProduct(t.db, { name: 'Soporte', priceCents: 10_000, currency: 'USD', status: 'inactivo' });
    const { agent } = await loggedInAgent(t, { role: 'consulta' });

    const res = await agent.get('/api/products');

    expect(res.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Abono mensual', priceCents: 1_500_000, currency: 'ARS', status: 'activo' }),
        expect.objectContaining({ name: 'Soporte', priceCents: 10_000, currency: 'USD', status: 'inactivo' }),
      ]),
    );
  });
});

describe('listado de facturas (RF-160, RF-168)', () => {
  /** Facturas de Los Andes y Ríos, de septiembre y octubre, en distintos estados. */
  function invoicesScenario() {
    const t = createTestApp({ now: NOW });
    const andes = insertClient(t.db, { businessName: 'Los Andes SA' });
    const rios = insertClient(t.db, { businessName: 'Estudio Ríos' });
    const rows = {
      andesSep: insertInvoice(t.db, { clientId: andes.id, period: '2026-09', number: 1, status: 'pagada' }),
      andesOct: insertInvoice(t.db, { clientId: andes.id, period: '2026-10', number: 2 }),
      riosSep: insertInvoice(t.db, { clientId: rios.id, period: '2026-09', number: 3, status: 'revision_manual' }),
      riosOct: insertInvoice(t.db, { clientId: rios.id, period: '2026-10', number: 4, status: 'pago_recibido' }),
      generating: insertInvoice(t.db, { clientId: rios.id, period: '2026-11', status: 'generando' }),
    };
    return { t, andes, rios, ...rows };
  }

  it('AC-167: lista las facturas en los cuatro estados con número, cliente, período, total, vencimiento y estado', async () => {
    const { t, andesSep, andesOct, riosSep, riosOct } = invoicesScenario();
    const { agent } = await loggedInAgent(t, { role: 'consulta' });

    const res = await agent.get('/api/invoices');

    expect(res.body.map((i: { id: number }) => i.id).sort()).toEqual(
      [andesSep.id, andesOct.id, riosSep.id, riosOct.id].sort(),
    );
    expect(res.body.find((i: { id: number }) => i.id === andesOct.id)).toMatchObject({
      pointOfSale: 1,
      voucherNumber: '00001-00000002',
      clientName: 'Los Andes SA',
      period: '2026-10',
      totalCents: andesOct.totalCents,
      dueDate: '2026-10-31',
      status: 'pendiente_de_pago',
    });
  });

  it('AC-175: filtra por estado, por cliente y por período, y combina los tres filtros', async () => {
    const { t, andes, andesSep, andesOct, riosSep } = invoicesScenario();
    const { agent } = await loggedInAgent(t, { role: 'consulta' });
    const ids = async (query: string) =>
      (await agent.get(`/api/invoices${query}`)).body.map((i: { id: number }) => i.id);

    expect(await ids(`?status=pendiente_de_pago&clientId=${andes.id}&period=2026-10`)).toEqual([andesOct.id]);
    expect(await ids('?status=revision_manual')).toEqual([riosSep.id]);
    expect((await ids(`?clientId=${andes.id}`)).sort()).toEqual([andesSep.id, andesOct.id].sort());
    expect((await ids('?period=2026-09')).sort()).toEqual([andesSep.id, riosSep.id].sort());
    expect(await ids(`?status=pagada&period=2026-10`)).toEqual([]);
  });

  it('rechaza filtros inválidos de estado o de período', async () => {
    const { t } = invoicesScenario();
    const { agent } = await loggedInAgent(t, { role: 'consulta' });
    expect((await agent.get('/api/invoices?status=generando')).status).toBe(400);
    expect((await agent.get('/api/invoices?period=2026-13')).status).toBe(400);
  });
});

describe('detalle y PDF de una factura (RF-162, RF-217)', () => {
  /** Factura de octubre generada por la corrida, con su PDF real. */
  async function billedInvoice() {
    const t = createTestApp({ now: '2026-10-15T14:00:00.000Z' });
    configureIssuer(t.db);
    const client = insertClient(t.db, {
      businessName: 'Los Andes SA',
      cuit: '30711111111',
      billingEmail: 'pagos@losandes.com',
      ivaCondition: 6,
    });
    assignProduct(t.db, client.id, insertProduct(t.db, { name: 'Abono mensual', priceCents: 1_500_000 }).id);
    await runBilling(t.ctx, { period: '2026-10', triggeredBy: 'agente_dia_15' });
    const [invoice] = (await (await loggedInAgent(t, { role: 'admin' })).agent.get('/api/invoices')).body;
    return { t, client, invoiceId: invoice.id as number };
  }

  it.each(['admin', 'editor', 'consulta'] as const)(
    'AC-169: un %s descarga el PDF de una factura emitida con el contenido de RF-93',
    async (role) => {
      const { t, invoiceId } = await billedInvoice();
      const { agent } = await loggedInAgent(t, { role });

      // Supertest no junta el cuerpo binario por defecto: se arma en un Buffer.
      const res = await agent
        .get(`/api/invoices/${invoiceId}/pdf`)
        .buffer(true)
        .parse((r, done) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => done(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toBe('attachment; filename="factura-C-00003-00000001.pdf"');
      const text = pdfText(new Uint8Array(res.body as Buffer)).replace(/\s+/g, ' ');
      expect(text).toContain('Factura C');
      expect(text).toContain('00003-00000001');
      expect(text).toContain('Los Andes SA');
      expect(text).toContain('30-71111111-1');
      expect(text).toContain('Abono mensual');
      expect(text).toContain('CAE');
    },
  );

  it('una factura que todavía se está generando no tiene PDF ni detalle, y una inexistente da 404', async () => {
    const t = createTestApp({ now: NOW });
    const client = insertClient(t.db);
    const generating = insertInvoice(t.db, { clientId: client.id, period: '2026-10', status: 'generando' });
    const { agent } = await loggedInAgent(t, { role: 'consulta' });

    expect((await agent.get(`/api/invoices/${generating.id}/pdf`)).status).toBe(404);
    expect((await agent.get(`/api/invoices/${generating.id}`)).status).toBe(404);
    expect((await agent.get('/api/invoices/999/pdf')).status).toBe(404);
  });

  it('sin sesión no se puede descargar el PDF', async () => {
    const { t, invoiceId } = await billedInvoice();
    expect((await anonymous(t).get(`/api/invoices/${invoiceId}/pdf`)).status).toBe(401);
  });

  it('AC-239: el detalle muestra datos, cuotas, PDF, los cambios de estado en orden con su actor y el email del comprobante', async () => {
    const { t, client, invoiceId } = await billedInvoice();
    t.adapters.clock.set('2026-10-20T13:00:00.000Z');
    t.adapters.classifier.fallback = { kind: 'si', cuit: '30711111111', amountRaw: '14000' };
    const email: IncomingEmail = {
      messageId: '<pago@losandes.com>',
      from: 'pagos@losandes.com',
      subject: 'Pago octubre',
      bodyText: 'Adjunto el comprobante.',
      receivedAt: new Date('2026-10-20T12:55:00.000Z'),
      attachments: [
        {
          filename: 'comprobante.pdf',
          mimeType: 'application/pdf',
          content: new TextEncoder().encode('%PDF-1.4'),
          inline: false,
        },
      ],
    };
    await processEmails(t.ctx, [email]);
    const { agent: editorAgent } = await loggedInAgent(t, { role: 'editor', name: 'Editora' });
    t.adapters.clock.set('2026-10-21T10:00:00.000Z'); // menos de 24 h después del login: la sesión sigue vigente
    const decided = await editorAgent
      .post(`/api/invoices/${invoiceId}/status`)
      .send({ to: 'pagada', expectedStatus: 'revision_manual' });
    expect(decided.status).toBe(200);
    const { agent } = await loggedInAgent(t, { role: 'consulta' });

    const res = await agent.get(`/api/invoices/${invoiceId}`);

    expect(res.status).toBe(200);
    expect(res.body.invoice).toMatchObject({
      id: invoiceId,
      clientId: client.id,
      clientName: 'Los Andes SA',
      voucherNumber: '00003-00000001',
      status: 'pagada',
      cae: expect.stringMatching(/^\d{14}$/),
    });
    expect(res.body.pdfUrl).toBe(`/api/invoices/${invoiceId}/pdf`);
    expect(res.body.items).toEqual([
      { description: 'Abono mensual', originalPriceCents: 1_500_000, originalCurrency: 'ARS', amountCents: 1_500_000 },
    ]);
    expect(res.body.statusChanges).toEqual([
      {
        fromStatus: 'pendiente_de_pago',
        toStatus: 'revision_manual',
        reason: 'monto no coincide',
        actor: { type: 'agente', userId: null, userName: null },
        changedAt: '2026-10-20T13:00:00.000Z',
      },
      {
        fromStatus: 'revision_manual',
        toStatus: 'pagada',
        reason: null,
        actor: { type: 'usuario', userId: expect.any(Number), userName: 'Editora' },
        changedAt: '2026-10-21T10:00:00.000Z',
      },
    ]);
    expect(res.body.emails).toEqual([
      expect.objectContaining({
        from: 'pagos@losandes.com',
        subject: 'Pago octubre',
        attachments: [
          expect.objectContaining({
            filename: 'comprobante.pdf',
            classification: 'si',
            cuit: '30711111111',
            amountCents: 1_400_000,
          }),
        ],
      }),
    ]);
  });
});
