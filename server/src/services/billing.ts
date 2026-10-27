import { and, asc, eq, inArray } from 'drizzle-orm';
import { ArcaRejectionError, type CaeRequest } from '../adapters/types.ts';
import type { AppContext } from '../context.ts';
import type { Db } from '../db/client.ts';
import { billingPeriods, clientProducts, clients, invoiceItems, invoices, products } from '../db/schema.ts';
import { invoiceDates } from '../domain/billing-dates.ts';
import { usdToArsCents } from '../domain/money.ts';
import { NoExchangeRateError, readRateForInvoice } from './exchange-rates.ts';
import { sendInvoiceEmail } from './invoice-email.ts';
import { recordProcessError } from './process-errors.ts';
import { getSettings, type Settings } from './settings.ts';

export type Invoice = typeof invoices.$inferSelect;
export type BillingTrigger = NonNullable<typeof billingPeriods.$inferSelect.triggeredBy>;

/** Factura C (RF-71). */
const VOUCHER_TYPE = 11 as const;

export const MISSING_ISSUER = 'faltan los datos de la empresa emisora o el punto de venta'; // RF-219
export const MISSING_IVA = 'el cliente no tiene cargada la condición frente al IVA'; // RF-83
const NO_RATE = 'no se pudo leer la cotización del dólar y no hay ninguna registrada'; // RF-68

/**
 * Resultado de generar la factura de un cliente. `retryable` indica si la falla se reintenta (RF-171):
 * un rechazo de validación de ARCA o un cliente que ya no es facturable no se reintentan.
 */
export type GenerationResult =
  | { status: 'generada'; invoiceId: number }
  | { status: 'fallida'; message: string; retryable: boolean };

const failed = (message: string, retryable = true): GenerationResult => ({ status: 'fallida', message, retryable });
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : 'error desconocido');

// ------------------------------------------------------------------ Candado por punto de venta

/**
 * Todo pedido de número y de CAE pasa por un candado por punto de venta: nunca hay dos solicitudes a
 * ARCA en paralelo para el mismo punto de venta (research R-05), venga de la corrida o de un reintento.
 */
const locks = new WeakMap<Db, Map<number, Promise<unknown>>>();

function withPointOfSaleLock<T>(db: Db, pointOfSale: number, task: () => Promise<T>): Promise<T> {
  const byPointOfSale = locks.get(db) ?? new Map<number, Promise<unknown>>();
  locks.set(db, byPointOfSale);
  const previous = byPointOfSale.get(pointOfSale) ?? Promise.resolve();
  const next = previous.then(task, task);
  // La cola sigue aunque una tarea falle; el error lo recibe quien la pidió.
  byPointOfSale.set(pointOfSale, next.catch(() => undefined));
  return next;
}

// ------------------------------------------------------------------ Datos de la factura

/** RF-219: datos obligatorios de la empresa emisora (RF-91) y punto de venta (RF-73). */
function issuerIsComplete(s: Settings): s is Settings & { pointOfSale: number } {
  return Boolean(
    s.pointOfSale &&
      s.issuerBusinessName &&
      s.issuerAddress &&
      s.issuerIvaCondition &&
      s.issuerGrossIncomeNumber &&
      s.issuerActivityStartDate,
  );
}

/** Productos Activos asignados al cliente, que son los que se facturan (RF-51, RF-94). */
function activeProducts(db: Db, clientId: number) {
  return db
    .select({ product: products })
    .from(clientProducts)
    .innerJoin(products, eq(clientProducts.productId, products.id))
    .where(and(eq(clientProducts.clientId, clientId), eq(products.status, 'activo')))
    .orderBy(asc(clientProducts.id))
    .all()
    .map((row) => row.product);
}

/** Clientes facturables: Activos y con al menos un producto Activo asignado (RF-51, RF-94, RF-95). */
export function billableClientIds(db: Db): number[] {
  return db
    .selectDistinct({ id: clients.id })
    .from(clients)
    .innerJoin(clientProducts, eq(clientProducts.clientId, clients.id))
    .innerJoin(products, eq(clientProducts.productId, products.id))
    .where(and(eq(clients.status, 'activo'), eq(products.status, 'activo')))
    .orderBy(asc(clients.id))
    .all()
    .map((row) => row.id);
}

const invoiceOf = (db: Db, clientId: number, period: string) =>
  db.select().from(invoices).where(and(eq(invoices.clientId, clientId), eq(invoices.period, period))).get();

const caeRequestOf = (invoice: Invoice, receiverCuit: string): CaeRequest => ({
  pointOfSale: invoice.pointOfSale,
  voucherType: VOUCHER_TYPE,
  number: invoice.number ?? 0,
  issueDate: invoice.issueDate,
  serviceFrom: invoice.serviceFrom,
  serviceTo: invoice.serviceTo,
  dueDate: invoice.dueDate,
  receiverCuit,
  receiverIvaCondition: invoice.ivaCondition,
  totalCents: invoice.totalCents,
});

// ------------------------------------------------------------------ Comprobantes ya autorizados

/**
 * RF-76: si ARCA ya autorizó el número que tiene reservado una factura en `generando` (y coinciden el
 * CUIT receptor y el importe), la registra con ese CAE y los datos guardados de la solicitud. Si no,
 * libera el número para que la factura no bloquee la numeración (research R-05). Debe correr con el
 * candado del punto de venta. Devuelve true si la factura quedó registrada.
 */
async function settleReservedNumber(ctx: AppContext, invoice: Invoice): Promise<boolean> {
  if (invoice.number === null) return false;
  const { db, adapters } = ctx;
  const voucher = await adapters.arca.findVoucher(invoice.pointOfSale, VOUCHER_TYPE, invoice.number);
  const receiverCuit = (invoice.clientSnapshot as { cuit: string }).cuit;
  const now = adapters.clock.now().toISOString();

  if (voucher && voucher.receiverCuit === receiverCuit && voucher.totalCents === invoice.totalCents) {
    db.update(invoices)
      .set({ cae: voucher.cae, caeDueDate: voucher.caeDueDate, status: 'pendiente_de_pago', updatedAt: now })
      .where(eq(invoices.id, invoice.id))
      .run();
    return true;
  }
  db.update(invoices).set({ number: null, updatedAt: now }).where(eq(invoices.id, invoice.id)).run();
  return false;
}

// ------------------------------------------------------------------ Generación

/**
 * Genera la factura del cliente para el período (RF-71 a RF-83, research R-05), de forma idempotente:
 * nunca hay dos facturas por cliente y período (RF-74) ni dos comprobantes en ARCA para una factura
 * (RF-75). Mientras ARCA no haya autorizado el comprobante, cada intento usa los datos vigentes del
 * cliente, sus productos y la cotización (RF-171). La usan la corrida, los reintentos y el reintento manual.
 */
export async function generateInvoice(
  ctx: AppContext,
  input: { clientId: number; period: string },
): Promise<GenerationResult> {
  const { db, adapters, env } = ctx;
  const settings = getSettings(db);
  if (!issuerIsComplete(settings)) return failed(MISSING_ISSUER);

  // Una factura ya registrada no se vuelve a generar (RF-74).
  let invoice = invoiceOf(db, input.clientId, input.period);
  if (invoice && invoice.status !== 'generando') return { status: 'generada', invoiceId: invoice.id };

  // Un intento anterior pudo quedar sin respuesta de ARCA: primero se averigua si lo autorizó (RF-76).
  if (invoice?.number != null) {
    const pending = invoice;
    try {
      if (await withPointOfSaleLock(db, pending.pointOfSale, () => settleReservedNumber(ctx, pending))) {
        return { status: 'generada', invoiceId: pending.id };
      }
    } catch (error) {
      return failed(errorMessage(error));
    }
  }

  const client = db.select().from(clients).where(eq(clients.id, input.clientId)).get();
  const items = client ? activeProducts(db, client.id) : [];
  if (!client || client.status !== 'activo' || items.length === 0) {
    return failed('el cliente no es facturable: está Inactivo o no tiene productos Activos asignados', false);
  }
  if (client.ivaCondition === null) return failed(MISSING_IVA);

  // La cotización se lee solo si hay cuotas en dólares, en cada intento (RF-63, AC-241).
  let rate: { id: number; rateCents: number } | null = null;
  if (items.some((product) => product.currency === 'USD')) {
    try {
      rate = await readRateForInvoice(db, adapters.fx, adapters.clock.now());
    } catch (error) {
      return failed(error instanceof NoExchangeRateError ? NO_RATE : errorMessage(error));
    }
  }

  const now = adapters.clock.now();
  const at = now.toISOString();
  const lines = items.map((product) => ({
    productId: product.id,
    description: product.name,
    originalPriceCents: product.priceCents,
    originalCurrency: product.currency,
    // RF-64: las cuotas en dólares se convierten a pesos con la cotización, redondeando al centavo.
    amountCents:
      product.currency === 'USD' ? usdToArsCents(product.priceCents, rate?.rateCents ?? 0) : product.priceCents,
  }));
  const data = {
    pointOfSale: settings.pointOfSale,
    voucherType: VOUCHER_TYPE,
    number: null,
    ...invoiceDates(input.period, now),
    totalCents: lines.reduce((sum, line) => sum + line.amountCents, 0),
    ivaCondition: client.ivaCondition,
    exchangeRateId: rate?.id ?? null,
    // Copias de los datos al emitir: cambios posteriores no alteran la factura (AC-36, AC-74, RF-92).
    clientSnapshot: {
      businessName: client.businessName,
      cuit: client.cuit,
      address: client.address,
      ivaCondition: client.ivaCondition,
    },
    issuerSnapshot: {
      cuit: env.arcaCuit,
      businessName: settings.issuerBusinessName,
      tradeName: settings.issuerTradeName,
      address: settings.issuerAddress,
      ivaCondition: settings.issuerIvaCondition,
      grossIncomeNumber: settings.issuerGrossIncomeNumber,
      activityStartDate: settings.issuerActivityStartDate,
    },
    status: 'generando' as const,
    updatedAt: at,
  };

  // Estado técnico `generando`: con los datos vigentes, todavía sin número ni CAE.
  invoice = db.transaction((tx) => {
    const saved = invoice
      ? (tx.update(invoices).set(data).where(eq(invoices.id, invoice.id)).returning().get() as Invoice)
      : tx
          .insert(invoices)
          .values({ ...data, clientId: client.id, period: input.period, createdAt: at })
          .returning()
          .get();
    tx.delete(invoiceItems).where(eq(invoiceItems.invoiceId, saved.id)).run();
    tx.insert(invoiceItems)
      .values(lines.map((line) => ({ ...line, invoiceId: saved.id })))
      .run();
    return saved;
  });

  const generating = invoice;
  return withPointOfSaleLock(db, generating.pointOfSale, () => requestCae(ctx, generating, client.cuit));
}

/**
 * Pide el número y el CAE de una factura en `generando` (research R-05). Corre con el candado del punto
 * de venta. Un rechazo de validación libera el número y no se reintenta; ante cualquier otra falla
 * (por ejemplo, un timeout) el número queda reservado, porque ARCA pudo haberlo autorizado.
 */
async function requestCae(ctx: AppContext, invoice: Invoice, receiverCuit: string): Promise<GenerationResult> {
  const { db, adapters } = ctx;
  const stamp = () => adapters.clock.now().toISOString();

  let number: number;
  try {
    number = (await adapters.arca.lastAuthorizedNumber(invoice.pointOfSale, VOUCHER_TYPE)) + 1;
    // Si otra factura en `generando` tiene ese número reservado, se resuelve antes de usarlo.
    for (;;) {
      const holder = db
        .select()
        .from(invoices)
        .where(and(eq(invoices.pointOfSale, invoice.pointOfSale), eq(invoices.number, number)))
        .get();
      if (!holder || holder.id === invoice.id) break;
      if (holder.status !== 'generando' || (await settleReservedNumber(ctx, holder))) number += 1;
      else break;
    }
  } catch (error) {
    return failed(errorMessage(error));
  }

  const request = caeRequestOf({ ...invoice, number }, receiverCuit);
  db.update(invoices)
    .set({ number, arcaRequest: request, arcaAttemptAt: stamp(), updatedAt: stamp() })
    .where(eq(invoices.id, invoice.id))
    .run();

  try {
    const { cae, caeDueDate } = await adapters.arca.requestCae(request);
    db.update(invoices)
      .set({ cae, caeDueDate, status: 'pendiente_de_pago', updatedAt: stamp() })
      .where(eq(invoices.id, invoice.id))
      .run();
    return { status: 'generada', invoiceId: invoice.id };
  } catch (error) {
    if (error instanceof ArcaRejectionError) {
      db.update(invoices).set({ number: null, updatedAt: stamp() }).where(eq(invoices.id, invoice.id)).run();
      return failed(error.message, false);
    }
    return failed(errorMessage(error));
  }
}

// ------------------------------------------------------------------ Corrida del período

/**
 * Períodos con una corrida en marcha en este proceso. "Facturar ahora" corre fuera del scheduler: así el
 * tick no lanza una segunda corrida del mismo período en paralelo creyéndola interrumpida.
 */
const runningPeriods = new WeakMap<Db, Set<string>>();

/** ¿Hay una corrida de ese período en marcha en este proceso? */
export function isBillingRunning(db: Db, period: string): boolean {
  return runningPeriods.get(db)?.has(period) ?? false;
}

export interface BillingRunSummary {
  generated: number[];
  failed: number[];
}

/**
 * Proceso de facturación del período (RF-51 a RF-53): factura a cada cliente facturable que todavía no
 * tiene la factura del período, de a uno, y deja el período `completado`. Retoma una corrida
 * interrumpida sin duplicar facturas (RF-53, RF-74). Una generación fallida queda como error de proceso
 * Pendiente (RF-174); los reintentos automáticos (RF-171) se suman en US7. Cada factura generada se envía
 * por email enseguida (RF-85). No factura un período cancelado.
 */
export async function runBilling(
  ctx: AppContext,
  input: { period: string; triggeredBy: BillingTrigger },
): Promise<BillingRunSummary> {
  const { db } = ctx;
  const summary: BillingRunSummary = { generated: [], failed: [] };
  const period = db.select().from(billingPeriods).where(eq(billingPeriods.period, input.period)).get();
  if (period?.status === 'cancelado' || period?.status === 'completado') return summary;
  if (isBillingRunning(db, input.period)) return summary;

  const running = runningPeriods.get(db) ?? new Set<string>();
  runningPeriods.set(db, running);
  running.add(input.period);
  try {
    return await bill(ctx, input, period, summary);
  } finally {
    running.delete(input.period);
  }
}

async function bill(
  ctx: AppContext,
  input: { period: string; triggeredBy: BillingTrigger },
  period: typeof billingPeriods.$inferSelect | undefined,
  summary: BillingRunSummary,
): Promise<BillingRunSummary> {
  const { db, adapters } = ctx;

  const startedAt = adapters.clock.now().toISOString();
  if (!period) {
    db.insert(billingPeriods)
      .values({ period: input.period, status: 'en_curso', triggeredBy: input.triggeredBy, startedAt })
      .run();
  } else if (period.status === 'pendiente') {
    db.update(billingPeriods)
      .set({ status: 'en_curso', triggeredBy: input.triggeredBy, startedAt })
      .where(eq(billingPeriods.id, period.id))
      .run();
  }

  const clientIds = billableClientIds(db);
  const done = new Set(
    clientIds.length === 0
      ? []
      : db
          .select({ clientId: invoices.clientId, status: invoices.status })
          .from(invoices)
          .where(and(eq(invoices.period, input.period), inArray(invoices.clientId, clientIds)))
          .all()
          .filter((row) => row.status !== 'generando')
          .map((row) => row.clientId),
  );

  for (const clientId of clientIds) {
    if (done.has(clientId)) continue;
    const result = await generateInvoice(ctx, { clientId, period: input.period });
    if (result.status === 'generada') {
      summary.generated.push(clientId);
      // RF-85: el email sale apenas se genera la factura, sin esperar a las de los demás clientes.
      const sent = await sendInvoiceEmail(ctx, result.invoiceId, 'automatico');
      if (sent.status === 'fallido') {
        // RF-86: el envío se reintenta sin volver a generar la factura (la cola llega en US7).
        recordProcessError(db, {
          operation: 'envio_factura',
          clientId,
          period: input.period,
          invoiceId: result.invoiceId,
          attempts: 1,
          message: sent.message,
          now: adapters.clock.now(),
        });
      }
      continue;
    }
    summary.failed.push(clientId);
    recordProcessError(db, {
      operation: 'generacion_factura',
      clientId,
      period: input.period,
      attempts: 1,
      message: result.message,
      now: adapters.clock.now(),
    });
  }

  db.update(billingPeriods)
    .set({ status: 'completado', completedAt: adapters.clock.now().toISOString() })
    .where(eq(billingPeriods.period, input.period))
    .run();
  return summary;
}
