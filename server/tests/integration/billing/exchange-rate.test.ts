import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { exchangeRates, fallbackAlerts, invoiceItems, invoices } from '../../../src/db/schema.ts';
import { generateInvoice } from '../../../src/services/billing.ts';
import {
  confirmFallback,
  NoExchangeRateError,
  pendingFallback,
  readRateForInvoice,
} from '../../../src/services/exchange-rates.ts';
import { timeout } from '../../helpers/fakes.ts';
import { createTestApp, type TestApp } from '../../helpers/test-app.ts';
import { assignProduct, configureIssuer, insertClient, insertProduct, insertUser } from '../../helpers/test-db.ts';

/** 15/10/2026 a las 11:00 de Argentina. */
const NOW = '2026-10-15T14:00:00.000Z';

/** Registra una cotización leída antes (RF-65). */
const insertRate = (t: TestApp, rateCents: number, readAt: string) =>
  t.db.insert(exchangeRates).values({ rateCents, source: 'dolarhoy.com', readAt }).returning().get();

const rates = (t: TestApp) => t.db.select().from(exchangeRates).all();

/** dolarhoy.com no responde dentro de 10 s (RNF-07). */
const fxDown = (t: TestApp) => t.adapters.fx.steps.push(timeout('dolarhoy.com'));

const invoiceOf = (t: TestApp, clientId: number) =>
  t.db.select().from(invoices).where(eq(invoices.clientId, clientId)).get();

/** Cliente facturable con un producto en la moneda indicada. */
function clientWith(t: TestApp, currency: 'ARS' | 'USD', priceCents: number) {
  const client = insertClient(t.db);
  const product = insertProduct(t.db, { currency, priceCents });
  assignProduct(t.db, client.id, product.id);
  return client;
}

function billingApp() {
  const t = createTestApp({ now: NOW });
  configureIssuer(t.db);
  return t;
}

describe('lectura y registro de la cotización (RF-63, RF-65)', () => {
  it('AC-65: cuando dolarhoy.com responde, la cotización queda registrada con su valor, la fuente y la fecha de lectura', async () => {
    const t = billingApp();
    t.adapters.fx.rateCents = 155_550;

    const rate = await readRateForInvoice(t.db, t.adapters.fx, t.adapters.clock.now());
    expect(rate).toMatchObject({ rateCents: 155_550, fallback: false });
    expect(rates(t)).toEqual([{ id: rate.id, rateCents: 155_550, source: 'dolarhoy.com', readAt: NOW }]);
    expect(pendingFallback(t.db)).toBeNull();
  });
});

describe('cotización de respaldo (RF-66, RF-67, RF-69)', () => {
  it('AC-65: si dolarhoy.com no responde, usa la última cotización por fecha de lectura y no registra ninguna nueva', async () => {
    const t = billingApp();
    // Se cargan fuera de orden: cuenta la fecha de lectura, no el orden de carga (RF-66).
    insertRate(t, 152_000, '2026-09-20T14:00:00.000Z');
    insertRate(t, 149_000, '2026-08-15T14:00:00.000Z');
    insertRate(t, 150_000, '2026-09-15T14:00:00.000Z');
    fxDown(t);

    const rate = await readRateForInvoice(t.db, t.adapters.fx, t.adapters.clock.now());
    expect(rate).toMatchObject({ rateCents: 152_000, readAt: '2026-09-20T14:00:00.000Z', fallback: true });
    expect(rates(t)).toHaveLength(3);
  });

  it('AC-66, RF-69: al usar la cotización de respaldo se muestra el banner con la cotización usada y su fecha', async () => {
    const t = billingApp();
    insertRate(t, 152_000, '2026-09-20T14:00:00.000Z');
    fxDown(t);

    await readRateForInvoice(t.db, t.adapters.fx, t.adapters.clock.now());
    expect(pendingFallback(t.db)).toEqual({ rateCents: 152_000, readAt: '2026-09-20T14:00:00.000Z', usedAt: NOW });
  });

  it('RF-68: si dolarhoy.com no responde y no hay ninguna cotización registrada, no hay cotización para facturar', async () => {
    const t = billingApp();
    fxDown(t);
    await expect(readRateForInvoice(t.db, t.adapters.fx, t.adapters.clock.now())).rejects.toBeInstanceOf(
      NoExchangeRateError,
    );
    expect(pendingFallback(t.db)).toBeNull();
  });
});

describe('confirmación del banner de cotización (RF-70)', () => {
  it('AC-69: al confirmar la cotización el banner deja de mostrarse y queda registrado qué usuario la confirmó', async () => {
    const t = billingApp();
    const editor = insertUser(t.db, { role: 'editor' });
    insertRate(t, 152_000, '2026-09-20T14:00:00.000Z');
    fxDown(t);
    await readRateForInvoice(t.db, t.adapters.fx, t.adapters.clock.now());

    confirmFallback(t.db, editor.id, t.adapters.clock.now());
    expect(pendingFallback(t.db)).toBeNull();
    expect(t.db.select().from(fallbackAlerts).all()).toEqual([
      expect.objectContaining({ confirmedByUserId: editor.id, confirmedAt: NOW }),
    ]);
  });

  it('un nuevo uso de la cotización de respaldo después de confirmar vuelve a mostrar el banner', async () => {
    const t = billingApp();
    const admin = insertUser(t.db, { role: 'admin' });
    insertRate(t, 152_000, '2026-09-20T14:00:00.000Z');
    fxDown(t);
    await readRateForInvoice(t.db, t.adapters.fx, t.adapters.clock.now());
    confirmFallback(t.db, admin.id, t.adapters.clock.now());

    fxDown(t);
    t.adapters.clock.advance(60 * 60 * 1000);
    await readRateForInvoice(t.db, t.adapters.fx, t.adapters.clock.now());
    expect(pendingFallback(t.db)).toMatchObject({ rateCents: 152_000, usedAt: '2026-10-15T15:00:00.000Z' });
  });
});

describe('la cotización en la factura (RF-63, RF-68)', () => {
  it('AC-63: convierte la cuota en dólares con la cotización leída y la registra en la factura con su fuente', async () => {
    const t = billingApp();
    t.adapters.fx.rateCents = 150_000; // $1.500
    const client = clientWith(t, 'USD', 10_000); // USD 100,00

    expect(await generateInvoice(t.ctx, { clientId: client.id, period: '2026-10' })).toMatchObject({ status: 'generada' });

    const invoice = invoiceOf(t, client.id);
    expect(invoice).toMatchObject({ status: 'pendiente_de_pago', totalCents: 15_000_000 });
    const rate = t.db.select().from(exchangeRates).where(eq(exchangeRates.id, invoice?.exchangeRateId ?? -1)).get();
    expect(rate).toMatchObject({ rateCents: 150_000, source: 'dolarhoy.com' });
    const items = t.db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice?.id ?? -1)).all();
    expect(items).toEqual([
      expect.objectContaining({ originalPriceCents: 10_000, originalCurrency: 'USD', amountCents: 15_000_000 }),
    ]);
  });

  it('AC-66: con dolarhoy.com sin responder, la factura registra la cotización de respaldo con su fecha', async () => {
    const t = billingApp();
    const fallback = insertRate(t, 152_000, '2026-09-20T14:00:00.000Z');
    fxDown(t);
    const client = clientWith(t, 'USD', 10_000);

    expect(await generateInvoice(t.ctx, { clientId: client.id, period: '2026-10' })).toMatchObject({ status: 'generada' });
    expect(invoiceOf(t, client.id)).toMatchObject({ exchangeRateId: fallback.id, totalCents: 15_200_000 });
    expect(pendingFallback(t.db)).toMatchObject({ rateCents: 152_000, readAt: '2026-09-20T14:00:00.000Z' });
  });

  it('AC-68, RF-68: sin cotización no se factura al cliente con productos en dólares, y sí al de solo pesos', async () => {
    const t = billingApp();
    const usd = clientWith(t, 'USD', 10_000);
    const ars = clientWith(t, 'ARS', 1_500_000);
    t.adapters.fx.steps.push(timeout('dolarhoy.com'), timeout('dolarhoy.com'));

    expect(await generateInvoice(t.ctx, { clientId: usd.id, period: '2026-10' })).toMatchObject({ status: 'fallida' });
    expect(invoiceOf(t, usd.id)).toBeUndefined();

    expect(await generateInvoice(t.ctx, { clientId: ars.id, period: '2026-10' })).toMatchObject({ status: 'generada' });
    expect(invoiceOf(t, ars.id)).toMatchObject({ status: 'pendiente_de_pago', totalCents: 1_500_000 });
  });

  it('R-13: la factura de un cliente con solo productos en pesos no lee la cotización ni la registra', async () => {
    const t = billingApp();
    const client = clientWith(t, 'ARS', 1_500_000);

    await generateInvoice(t.ctx, { clientId: client.id, period: '2026-10' });
    expect(t.adapters.fx.calls).toBe(0);
    expect(invoiceOf(t, client.id)?.exchangeRateId).toBeNull();
    expect(rates(t)).toHaveLength(0);
  });

  it('AC-241: si la generación falla, el siguiente intento vuelve a leer la cotización y la factura usa la nueva', async () => {
    const t = billingApp();
    const client = clientWith(t, 'USD', 10_000);
    t.adapters.fx.steps.push(150_000, 152_000); // $1.500 en el primer intento y $1.520 en el segundo
    t.adapters.arca.caeSteps.push(timeout('WSFEv1')); // ARCA no responde en el primer intento

    expect(await generateInvoice(t.ctx, { clientId: client.id, period: '2026-10' })).toMatchObject({ status: 'fallida' });
    expect(await generateInvoice(t.ctx, { clientId: client.id, period: '2026-10' })).toMatchObject({ status: 'generada' });

    const invoice = invoiceOf(t, client.id);
    expect(invoice).toMatchObject({ status: 'pendiente_de_pago', totalCents: 15_200_000 });
    const rate = t.db.select().from(exchangeRates).where(eq(exchangeRates.id, invoice?.exchangeRateId ?? -1)).get();
    expect(rate?.rateCents).toBe(152_000);
    expect(t.adapters.fx.calls).toBe(2);
    // ARCA recibe el importe recalculado con la cotización nueva.
    expect(t.adapters.arca.requests.at(-1)?.totalCents).toBe(15_200_000);
  });
});
