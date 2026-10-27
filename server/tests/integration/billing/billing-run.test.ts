import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { billingPeriods, clientProducts, clients, invoiceItems, invoices, products } from '../../../src/db/schema.ts';
import { runBilling } from '../../../src/services/billing.ts';
import { createTestApp, type TestApp } from '../../helpers/test-app.ts';
import {
  assignProduct,
  configureIssuer,
  insertClient,
  insertInvoice,
  insertProduct,
} from '../../helpers/test-db.ts';

/** 11:00 de Argentina del día 15 de cada mes. */
const SEPT_15 = '2026-09-15T14:00:00.000Z';
const OCT_15 = '2026-10-15T14:00:00.000Z';

function billingApp(now = OCT_15) {
  const t = createTestApp({ now });
  configureIssuer(t.db);
  return t;
}

const run = (t: TestApp, period: string) => runBilling(t.ctx, { period, triggeredBy: 'agente_dia_15' });

const invoicesOf = (t: TestApp, clientId: number) =>
  t.db.select().from(invoices).where(eq(invoices.clientId, clientId)).orderBy(asc(invoices.period)).all();

const itemsOf = (t: TestApp, invoiceId: number) =>
  t.db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId)).orderBy(asc(invoiceItems.id)).all();

const allInvoices = (t: TestApp) => t.db.select().from(invoices).all();

/** Cliente Activo con los productos indicados asignados. */
function clientWith(t: TestApp, ...productList: Array<ReturnType<typeof insertProduct>>) {
  const client = insertClient(t.db, { ivaCondition: 6 });
  for (const product of productList) assignProduct(t.db, client.id, product.id);
  return client;
}

describe('corrida de facturación del día 15 (RF-51, RF-94, RF-95)', () => {
  it('AC-51: genera una factura C por cliente Activo con productos Activos, con el detalle de cada cuota, en Pendiente de pago', async () => {
    const t = billingApp();
    const abono = insertProduct(t.db, { name: 'Abono', priceCents: 1_500_000, currency: 'ARS' });
    const soporte = insertProduct(t.db, { name: 'Soporte', priceCents: 500_000, currency: 'ARS' });
    const a = clientWith(t, abono, soporte);
    const b = clientWith(t, abono);

    await run(t, '2026-10');

    const [invoiceA] = invoicesOf(t, a.id);
    expect(invoiceA).toMatchObject({
      period: '2026-10',
      voucherType: 11,
      pointOfSale: 3,
      status: 'pendiente_de_pago',
      totalCents: 2_000_000,
      issueDate: '2026-10-15',
    });
    expect(invoiceA?.cae).toMatch(/^\d{14}$/);
    expect(itemsOf(t, invoiceA?.id ?? -1)).toEqual([
      expect.objectContaining({ description: 'Abono', amountCents: 1_500_000, productId: abono.id }),
      expect.objectContaining({ description: 'Soporte', amountCents: 500_000, productId: soporte.id }),
    ]);
    expect(invoicesOf(t, b.id)).toHaveLength(1);
    expect(t.db.select().from(billingPeriods).where(eq(billingPeriods.period, '2026-10')).get()).toMatchObject({
      status: 'completado',
      triggeredBy: 'agente_dia_15',
    });
  });

  it('AC-49: el total es la suma de las cuotas, con las cuotas en dólares convertidas con la cotización', async () => {
    const t = billingApp();
    t.adapters.fx.rateCents = 150_000; // $1.500
    const client = clientWith(
      t,
      insertProduct(t.db, { priceCents: 1_500_000, currency: 'ARS' }),
      insertProduct(t.db, { priceCents: 10_000, currency: 'USD' }), // USD 100 → $150.000
    );

    await run(t, '2026-10');
    expect(invoicesOf(t, client.id)[0]?.totalCents).toBe(16_500_000);
  });

  it('AC-85: un cliente Activo sin productos asignados no se factura', async () => {
    const t = billingApp();
    const client = insertClient(t.db);
    await run(t, '2026-10');
    expect(invoicesOf(t, client.id)).toHaveLength(0);
    expect(t.adapters.arca.requests).toHaveLength(0);
  });

  it('AC-86: un cliente Activo cuyo único producto está Inactivo no se factura', async () => {
    const t = billingApp();
    const client = clientWith(t, insertProduct(t.db, { status: 'inactivo' }));
    await run(t, '2026-10');
    expect(invoicesOf(t, client.id)).toHaveLength(0);
    expect(t.adapters.arca.requests).toHaveLength(0);
  });

  it('AC-87: un cliente Inactivo con productos asignados no se factura', async () => {
    const t = billingApp();
    const client = insertClient(t.db, { status: 'inactivo' });
    assignProduct(t.db, client.id, insertProduct(t.db).id);
    await run(t, '2026-10');
    expect(invoicesOf(t, client.id)).toHaveLength(0);
  });

  it('AC-47, AC-48: solo se facturan los productos Activos; uno reactivado vuelve a incluirse', async () => {
    const t = billingApp(SEPT_15);
    const active = insertProduct(t.db, { name: 'Abono', priceCents: 1_000_000 });
    const inactive = insertProduct(t.db, { name: 'Viejo', priceCents: 300_000, status: 'inactivo' });
    const client = clientWith(t, active, inactive);

    await run(t, '2026-09');
    const [september] = invoicesOf(t, client.id);
    expect(itemsOf(t, september?.id ?? -1).map((i) => i.description)).toEqual(['Abono']);
    expect(september?.totalCents).toBe(1_000_000);

    t.db.update(products).set({ status: 'activo' }).where(eq(products.id, inactive.id)).run();
    t.adapters.clock.set(OCT_15);
    await run(t, '2026-10');
    const october = invoicesOf(t, client.id)[1];
    expect(itemsOf(t, october?.id ?? -1).map((i) => i.description)).toEqual(['Abono', 'Viejo']);
    expect(october?.totalCents).toBe(1_300_000);
  });

  it('AC-39: un cliente reactivado recibe una única factura, solo por el período corriente', async () => {
    const t = billingApp(SEPT_15);
    const client = insertClient(t.db, { status: 'inactivo' });
    assignProduct(t.db, client.id, insertProduct(t.db).id);
    await run(t, '2026-09');
    expect(invoicesOf(t, client.id)).toHaveLength(0);

    t.db.update(clients).set({ status: 'activo' }).where(eq(clients.id, client.id)).run();
    t.adapters.clock.set(OCT_15);
    await run(t, '2026-10');
    expect(invoicesOf(t, client.id).map((i) => i.period)).toEqual(['2026-10']);
  });
});

describe('datos vigentes al facturar, sin alterar las facturas emitidas (AC-36, AC-45, AC-46, AC-50, AC-74)', () => {
  it('la factura siguiente usa la razón social, la condición frente al IVA, los nombres, los precios y las asignaciones vigentes; la emitida no cambia', async () => {
    const t = billingApp(SEPT_15);
    const abono = insertProduct(t.db, { name: 'Abono', priceCents: 1_000_000 });
    const soporte = insertProduct(t.db, { name: 'Soporte', priceCents: 500_000 });
    const client = insertClient(t.db, { businessName: 'Los Andes SRL', ivaCondition: 6 });
    assignProduct(t.db, client.id, abono.id);
    assignProduct(t.db, client.id, soporte.id);

    await run(t, '2026-09');
    const september = invoicesOf(t, client.id)[0];
    const septemberItems = itemsOf(t, september?.id ?? -1);

    // Cambios entre una corrida y la siguiente.
    t.db.update(clients).set({ businessName: 'Los Andes SA', ivaCondition: 1 }).where(eq(clients.id, client.id)).run(); // AC-36, AC-74
    t.db.update(products).set({ name: 'Abono plus', priceCents: 1_200_000 }).where(eq(products.id, abono.id)).run(); // AC-45, AC-46
    t.db.delete(clientProducts).where(eq(clientProducts.productId, soporte.id)).run(); // AC-50

    t.adapters.clock.set(OCT_15);
    await run(t, '2026-10');
    const october = invoicesOf(t, client.id)[1];

    expect(october).toMatchObject({ totalCents: 1_200_000, ivaCondition: 1 });
    expect(october?.clientSnapshot).toMatchObject({ businessName: 'Los Andes SA', ivaCondition: 1 });
    expect(itemsOf(t, october?.id ?? -1)).toEqual([
      expect.objectContaining({ description: 'Abono plus', amountCents: 1_200_000 }),
    ]);
    // AC-74, RF-77: a ARCA se informa la condición vigente.
    expect(t.adapters.arca.requests.at(-1)).toMatchObject({ receiverIvaCondition: 1, totalCents: 1_200_000 });

    // La factura de septiembre conserva sus datos.
    expect(invoicesOf(t, client.id)[0]).toEqual(september);
    expect(september).toMatchObject({ ivaCondition: 6, totalCents: 1_500_000 });
    expect(september?.clientSnapshot).toMatchObject({ businessName: 'Los Andes SRL', ivaCondition: 6 });
    expect(itemsOf(t, september?.id ?? -1)).toEqual(septemberItems);
    expect(septemberItems.map((i) => i.description)).toEqual(['Abono', 'Soporte']);
  });
});

describe('una sola factura por cliente y período (RF-53, RF-74)', () => {
  it('AC-72: si la corrida se repite en el mismo mes, no genera otra factura ni pide otro CAE', async () => {
    const t = billingApp();
    const client = clientWith(t, insertProduct(t.db));

    await run(t, '2026-10');
    await run(t, '2026-10');
    expect(invoicesOf(t, client.id)).toHaveLength(1);
    expect(t.adapters.arca.requests).toHaveLength(1);
  });

  it('AC-54: una corrida interrumpida se retoma, factura a los que faltaban y no duplica a los que ya tenían', async () => {
    const t = billingApp();
    const product = insertProduct(t.db);
    const billed = clientWith(t, product);
    const pending = clientWith(t, product);
    // Corrida que quedó en curso después de facturar al primer cliente.
    t.db.insert(billingPeriods).values({ period: '2026-10', status: 'en_curso', triggeredBy: 'agente_dia_15', startedAt: OCT_15 }).run();
    insertInvoice(t.db, { clientId: billed.id, period: '2026-10', status: 'pendiente_de_pago' });

    await runBilling(t.ctx, { period: '2026-10', triggeredBy: 'agente_recuperacion' });

    expect(invoicesOf(t, billed.id)).toHaveLength(1);
    expect(invoicesOf(t, pending.id)).toHaveLength(1);
    expect(t.adapters.arca.requests).toHaveLength(1);
    expect(t.adapters.arca.requests[0]?.receiverCuit).toBe(pending.cuit);
    expect(t.db.select().from(billingPeriods).where(eq(billingPeriods.period, '2026-10')).get()?.status).toBe(
      'completado',
    );
  });

  it('cada cliente facturable recibe exactamente una factura en una corrida con varios clientes', async () => {
    const t = billingApp();
    const product = insertProduct(t.db);
    for (let i = 0; i < 5; i += 1) clientWith(t, product);
    await run(t, '2026-10');
    expect(allInvoices(t)).toHaveLength(5);
    expect(new Set(allInvoices(t).map((i) => i.number)).size).toBe(5);
  });
});
