import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ArcaRejectionError, type CaeRequest, type CaeResult } from '../../../src/adapters/types.ts';
import { invoiceItems, invoices, processErrors, products, retryQueue, settings } from '../../../src/db/schema.ts';
import { generateInvoice, runBilling } from '../../../src/services/billing.ts';
import { timeout } from '../../helpers/fakes.ts';
import { createTestApp, type TestApp } from '../../helpers/test-app.ts';
import { assignProduct, configureIssuer, insertClient, insertProduct } from '../../helpers/test-db.ts';

const OCT_15 = '2026-10-15T14:00:00.000Z';

const MISSING_IVA = 'el cliente no tiene cargada la condición frente al IVA';
const MISSING_ISSUER = 'faltan los datos de la empresa emisora o el punto de venta';

function billingApp(overrides: Partial<typeof settings.$inferInsert> = {}) {
  const t = createTestApp({ now: OCT_15 });
  configureIssuer(t.db, overrides);
  return t;
}

function billableClient(t: TestApp, overrides: Parameters<typeof insertClient>[1] = {}, priceCents = 1_000_000) {
  const client = insertClient(t.db, { ivaCondition: 6, ...overrides });
  const product = insertProduct(t.db, { priceCents });
  assignProduct(t.db, client.id, product.id);
  return { client, product };
}

const generate = (t: TestApp, clientId: number, period = '2026-10') => generateInvoice(t.ctx, { clientId, period });
const run = (t: TestApp, period = '2026-10') => runBilling(t.ctx, { period, triggeredBy: 'agente_dia_15' });

const invoiceOf = (t: TestApp, clientId: number) =>
  t.db.select().from(invoices).where(eq(invoices.clientId, clientId)).get();
const errors = (t: TestApp) => t.db.select().from(processErrors).orderBy(asc(processErrors.id)).all();

/** ARCA autoriza el comprobante, pero la respuesta no llega a tiempo (RNF-07). */
const authorizeThenTimeout = (_req: CaeRequest, authorize: () => unknown) => {
  authorize();
  throw timeout('WSFEv1');
};

describe('tipo de comprobante y punto de venta (RF-71 a RF-73)', () => {
  it('AC-70: la solicitud a WSFEv1 usa Factura C (11) y el punto de venta configurado, y ambos quedan en la factura', async () => {
    const t = billingApp({ pointOfSale: 3 });
    const { client } = billableClient(t);

    await generate(t, client.id);
    expect(t.adapters.arca.requests[0]).toMatchObject({ voucherType: 11, pointOfSale: 3, number: 1 });
    expect(invoiceOf(t, client.id)).toMatchObject({ voucherType: 11, pointOfSale: 3, number: 1 });
  });

  it('AC-71: al cambiar el punto de venta a 5, la siguiente factura se emite en el punto de venta 5', async () => {
    const t = billingApp({ pointOfSale: 3 });
    const { client } = billableClient(t);
    t.db.update(settings).set({ pointOfSale: 5 }).run();

    await generate(t, client.id);
    expect(t.adapters.arca.requests[0]?.pointOfSale).toBe(5);
    expect(invoiceOf(t, client.id)?.pointOfSale).toBe(5);
  });
});

describe('un solo comprobante por factura (RF-75, RF-76, research R-05)', () => {
  it('AC-73: si ARCA autorizó pero la respuesta no llegó, el siguiente intento registra ese número y CAE sin pedir otro', async () => {
    const t = billingApp();
    const { client } = billableClient(t);
    t.adapters.arca.caeSteps.push(authorizeThenTimeout);

    expect(await generate(t, client.id)).toMatchObject({ status: 'fallida' });
    const authorized = t.adapters.arca.vouchers.get('3:1');
    expect(authorized).toBeDefined();

    expect(await generate(t, client.id)).toMatchObject({ status: 'generada' });
    expect(t.adapters.arca.requests).toHaveLength(1);
    expect(t.adapters.arca.vouchers.size).toBe(1);
    expect(invoiceOf(t, client.id)).toMatchObject({
      status: 'pendiente_de_pago',
      number: 1,
      cae: authorized?.cae,
      caeDueDate: authorized?.caeDueDate,
    });
  });

  it('R-05: si ARCA ya autorizó, el reintento registra los datos de la solicitud autorizada aunque después cambie el precio', async () => {
    const t = billingApp();
    const { client, product } = billableClient(t, {}, 1_000_000);
    t.adapters.arca.caeSteps.push(authorizeThenTimeout);
    await generate(t, client.id);

    t.db.update(products).set({ priceCents: 2_000_000 }).where(eq(products.id, product.id)).run();
    await generate(t, client.id);

    const invoice = invoiceOf(t, client.id);
    expect(invoice?.totalCents).toBe(1_000_000);
    const items = t.db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice?.id ?? -1)).all();
    expect(items.map((i) => i.amountCents)).toEqual([1_000_000]);
  });

  it('RF-171: si ARCA no autorizó, el reintento usa los datos vigentes (por ejemplo, el precio nuevo)', async () => {
    const t = billingApp();
    const { client, product } = billableClient(t, {}, 1_000_000);
    t.adapters.arca.caeSteps.push(timeout('WSFEv1'));
    await generate(t, client.id);

    t.db.update(products).set({ priceCents: 2_000_000 }).where(eq(products.id, product.id)).run();
    expect(await generate(t, client.id)).toMatchObject({ status: 'generada' });
    expect(invoiceOf(t, client.id)?.totalCents).toBe(2_000_000);
    expect(t.adapters.arca.requests.at(-1)?.totalCents).toBe(2_000_000);
  });

  it('R-05: un número que ARCA no autorizó se libera y no bloquea la factura siguiente', async () => {
    const t = billingApp();
    const a = billableClient(t).client;
    const b = billableClient(t).client;
    t.adapters.arca.caeSteps.push(timeout('WSFEv1')); // ARCA no autoriza el número 1 de A

    expect(await generate(t, a.id)).toMatchObject({ status: 'fallida' });
    expect(await generate(t, b.id)).toMatchObject({ status: 'generada' });
    expect(invoiceOf(t, b.id)).toMatchObject({ status: 'pendiente_de_pago', number: 1 });

    expect(await generate(t, a.id)).toMatchObject({ status: 'generada' });
    expect(invoiceOf(t, a.id)).toMatchObject({ status: 'pendiente_de_pago', number: 2 });
    expect([...t.adapters.arca.vouchers.keys()].sort()).toEqual(['3:1', '3:2']);
  });

  it('R-05: los pedidos de número y CAE nunca corren en paralelo, aunque se generen dos facturas a la vez', async () => {
    const t = billingApp();
    const a = billableClient(t).client;
    const b = billableClient(t).client;
    let inFlight = 0;
    let maxInFlight = 0;
    // ARCA tarda en responder: si dos pedidos se superpusieran, inFlight llegaría a 2.
    const slowAuthorize = async (_req: CaeRequest, authorize: () => CaeResult): Promise<CaeResult> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return authorize();
    };
    t.adapters.arca.caeSteps.push(slowAuthorize, slowAuthorize);

    const results = await Promise.all([generate(t, a.id), generate(t, b.id)]);
    expect(results).toEqual([
      expect.objectContaining({ status: 'generada' }),
      expect.objectContaining({ status: 'generada' }),
    ]);
    expect(maxInFlight).toBe(1);
    expect([invoiceOf(t, a.id)?.number, invoiceOf(t, b.id)?.number].sort()).toEqual([1, 2]);
  });
});

describe('rechazos de ARCA (RF-171)', () => {
  it('AC-247: un rechazo por validación no se reintenta: error de proceso inmediato con el mensaje de ARCA y número liberado', async () => {
    const t = billingApp({ retryCount: 3 });
    const a = billableClient(t).client;
    const message = '10015: El campo DocNro no corresponde a un CUIT válido.';
    t.adapters.arca.caeSteps.push(new ArcaRejectionError(message));

    await run(t);

    expect(invoiceOf(t, a.id)?.status).not.toBe('pendiente_de_pago');
    expect(t.adapters.arca.requests).toHaveLength(1);
    expect(t.db.select().from(retryQueue).all()).toHaveLength(0);
    expect(errors(t)).toEqual([
      expect.objectContaining({
        operation: 'generacion_factura',
        clientId: a.id,
        period: '2026-10',
        status: 'pendiente',
        attempts: 1,
        lastErrorMessage: expect.stringContaining(message),
      }),
    ]);

    // El número 1 quedó libre: la factura siguiente lo usa.
    const b = billableClient(t).client;
    await generate(t, b.id);
    expect(invoiceOf(t, b.id)?.number).toBe(1);
  });
});

describe('fallas antes de llamar a ARCA (RF-82, RF-83, RF-68, RF-219)', () => {
  it('AC-77: un cliente sin condición frente al IVA no se factura, no se llama a ARCA y queda un error de proceso Pendiente', async () => {
    const t = billingApp({ retryCount: 0 });
    const { client } = billableClient(t, { ivaCondition: null });

    await run(t);

    expect(invoiceOf(t, client.id)).toBeUndefined();
    expect(t.adapters.arca.requests).toHaveLength(0);
    expect(errors(t)).toEqual([
      expect.objectContaining({
        operation: 'generacion_factura',
        clientId: client.id,
        period: '2026-10',
        status: 'pendiente',
        attempts: 1,
        lastErrorMessage: MISSING_IVA,
      }),
    ]);
  });

  it('AC-67: sin cotización, el cliente con productos en dólares no se factura ni recibe email, y queda un error de proceso Pendiente', async () => {
    const t = billingApp({ retryCount: 0 });
    const client = insertClient(t.db, { ivaCondition: 6 });
    assignProduct(t.db, client.id, insertProduct(t.db, { currency: 'USD', priceCents: 10_000 }).id);
    t.adapters.fx.steps.push(timeout('dolarhoy.com'));

    await run(t);

    expect(invoiceOf(t, client.id)).toBeUndefined();
    expect(t.adapters.arca.requests).toHaveLength(0);
    expect(t.adapters.mailSender.sent).toHaveLength(0);
    expect(errors(t)).toEqual([
      expect.objectContaining({ operation: 'generacion_factura', clientId: client.id, status: 'pendiente' }),
    ]);
  });

  it('AC-242: sin razón social de la empresa emisora no se genera ninguna factura ni se llama a ARCA, y hay un error por cliente', async () => {
    const t = billingApp({ retryCount: 0, issuerBusinessName: null });
    const a = billableClient(t).client;
    const b = billableClient(t).client;

    await run(t);

    expect(t.db.select().from(invoices).all()).toHaveLength(0);
    expect(t.adapters.arca.requests).toHaveLength(0);
    expect(errors(t).map((e) => [e.clientId, e.lastErrorMessage])).toEqual([
      [a.id, MISSING_ISSUER],
      [b.id, MISSING_ISSUER],
    ]);
  });

  it('RF-219: sin punto de venta configurado tampoco se factura ni se llama a ARCA', async () => {
    const t = billingApp({ retryCount: 0, pointOfSale: null });
    const { client } = billableClient(t);

    await run(t);

    expect(invoiceOf(t, client.id)).toBeUndefined();
    expect(t.adapters.arca.requests).toHaveLength(0);
    expect(errors(t)).toEqual([expect.objectContaining({ clientId: client.id, lastErrorMessage: MISSING_ISSUER })]);
  });
});
