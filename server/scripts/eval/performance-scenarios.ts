/**
 * Escenarios de rendimiento (RNF-01, RNF-03 a RNF-06; AC-232 a AC-234) sobre una base propia, con los
 * adapters que reciba: los reales desde `performance.ts`, los fake desde los tests. Cada escenario carga
 * el volumen de referencia y mide el proceso completo con el reloj de la máquina.
 */
import { performance } from 'node:perf_hooks';
import { eq } from 'drizzle-orm';
import type { EmailAttachment } from '../../src/adapters/types.ts';
import type { AppContext } from '../../src/context.ts';
import { clientProducts, clients, invoices, products, sentEmails, settings } from '../../src/db/schema.ts';
import { currentPeriod } from '../../src/domain/billing-dates.ts';
import { isValidCuit } from '../../src/domain/cuit.ts';
import { createRemindersJob } from '../../src/jobs/reminders-job.ts';
import { runBilling } from '../../src/services/billing.ts';
import { processEmails } from '../../src/services/payment-processing.ts';

/** RNF-03 y RNF-04: 20 minutos para la facturación y para los recordatorios. */
export const BATCH_LIMIT_MS = 20 * 60 * 1000;
/** RNF-01: p95 menor a 60 segundos por email. */
export const EMAIL_LIMIT_MS = 60 * 1000;

export interface ScenarioResult {
  name: string;
  /** Ítems del volumen de referencia y cuántos terminaron bien. */
  items: number;
  ok: number;
  durationMs: number;
  /** Solo en el escenario de emails: el p95 de cada email. */
  p95Ms?: number;
  limitMs: number;
  passed: boolean;
}

/** Percentil por el método nearest-rank: el valor en la posición ⌈p·n⌉ de la lista ordenada. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) throw new Error('No hay valores para calcular el percentil.');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
}

/** El n-ésimo CUIT válido que empieza con 30 (personas jurídicas), para datos de prueba. */
function validCuit(n: number): string {
  for (let body = 50_000_000 + n * 7; ; body++) {
    for (let check = 0; check <= 9; check++) {
      const cuit = `30${body}${check}`;
      if (isValidCuit(cuit)) return cuit;
    }
  }
}

const iso = (ctx: AppContext) => ctx.adapters.clock.now().toISOString();

/** Clientes Activos de prueba, con email de facturación en un dominio reservado que no existe. */
function seedClients(ctx: AppContext, count: number) {
  const at = iso(ctx);
  return Array.from({ length: count }, (_, i) =>
    ctx.db
      .insert(clients)
      .values({
        businessName: `Cliente de rendimiento ${i + 1}`,
        cuit: validCuit(i),
        address: 'Av. de Prueba 123, CABA',
        billingEmail: `cliente-${i + 1}@rendimiento.invalid`,
        billingEmailNormalized: `cliente-${i + 1}@rendimiento.invalid`,
        ivaCondition: 5,
        status: 'activo',
        createdAt: at,
        updatedAt: at,
      })
      .returning()
      .get(),
  );
}

/** Factura emitida del mes en Pendiente de pago, para los escenarios que necesitan deuda vigente. */
function seedOwedInvoice(ctx: AppContext, clientId: number, number: number, totalCents: number) {
  const now = ctx.adapters.clock.now();
  const at = now.toISOString();
  const period = currentPeriod(now);
  ctx.db
    .insert(invoices)
    .values({
      clientId,
      period,
      pointOfSale: 1,
      number,
      issueDate: `${period}-15`,
      serviceFrom: `${period}-01`,
      serviceTo: `${period}-28`,
      dueDate: `${period}-28`,
      totalCents,
      cae: '71234567890123',
      caeDueDate: `${period}-25`,
      ivaCondition: 5,
      clientSnapshot: {},
      issuerSnapshot: {},
      status: 'pendiente_de_pago',
      createdAt: at,
      updatedAt: at,
    })
    .run();
}

/** Datos de la empresa emisora, para poder facturar (RF-91, RF-219). */
function configureIssuer(ctx: AppContext, pointOfSale: number) {
  ctx.db
    .update(settings)
    .set({
      pointOfSale,
      issuerBusinessName: 'Empresa de prueba de rendimiento',
      issuerAddress: 'Av. de Prueba 123, CABA',
      issuerIvaCondition: 'Responsable Monotributo',
      issuerGrossIncomeNumber: '901-000000-0',
      issuerActivityStartDate: '2020-01-01',
    })
    .where(eq(settings.id, 1))
    .run();
}

/**
 * AC-233 (RNF-03, RNF-05): `clients` clientes Activos con 2 productos cada uno, de un catálogo de 10 en
 * pesos; mide la corrida completa de facturación, con la generación en ARCA y el envío de cada email.
 */
export async function runBillingScenario(
  ctx: AppContext,
  options: { clients: number; pointOfSale: number },
): Promise<ScenarioResult> {
  configureIssuer(ctx, options.pointOfSale);
  const at = iso(ctx);
  const catalog = Array.from({ length: 10 }, (_, i) =>
    ctx.db
      .insert(products)
      .values({
        name: `Producto ${i + 1}`,
        priceCents: (i + 1) * 100_000,
        currency: 'ARS',
        status: 'activo',
        createdAt: at,
        updatedAt: at,
      })
      .returning()
      .get(),
  );
  seedClients(ctx, options.clients).forEach((client, i) => {
    for (const product of [catalog[i % 10]!, catalog[(i + 3) % 10]!]) {
      ctx.db.insert(clientProducts).values({ clientId: client.id, productId: product.id, assignedAt: at }).run();
    }
  });

  const start = performance.now();
  const period = currentPeriod(ctx.adapters.clock.now());
  const summary = await runBilling(ctx, { period, triggeredBy: 'facturar_ahora' });
  const durationMs = performance.now() - start;
  return batchResult('facturación', options.clients, summary.generated.length, durationMs);
}

/**
 * AC-234 (RNF-04, RNF-06): `clients` clientes Activos con una factura adeudada y sin revisión; mide la
 * corrida de recordatorios de fin de mes con el envío de cada email.
 */
export async function runRemindersScenario(ctx: AppContext, options: { clients: number }): Promise<ScenarioResult> {
  configureIssuer(ctx, 1);
  const now = ctx.adapters.clock.now();
  seedClients(ctx, options.clients).forEach((client, i) => seedOwedInvoice(ctx, client.id, i + 1, 1_000_000));

  const start = performance.now();
  // El proceso se ejecuta como lo hace el tick el último día del mes, sin esperar a esa fecha.
  await createRemindersJob(ctx).run(now);
  const durationMs = performance.now() - start;
  const sent = ctx.db.select().from(sentEmails).where(eq(sentEmails.kind, 'recordatorio')).all().length;
  return batchResult('recordatorios', options.clients, sent, durationMs);
}

function batchResult(name: string, items: number, ok: number, durationMs: number): ScenarioResult {
  const passed = ok === items && durationMs <= BATCH_LIMIT_MS;
  return { name, items, ok, durationMs, limitMs: BATCH_LIMIT_MS, passed };
}

/**
 * AC-232 (RNF-01): `emails` emails de clientes con deuda, cada uno con un adjunto; mide cada email por
 * separado desde que se detecta hasta que queda registrado su resultado (clasificación y validación).
 */
export async function runEmailsScenario(
  ctx: AppContext,
  options: { emails: number; attachment: (index: number) => EmailAttachment },
): Promise<ScenarioResult> {
  const now = ctx.adapters.clock.now();
  const seeded = seedClients(ctx, options.emails);
  seeded.forEach((client, i) => seedOwedInvoice(ctx, client.id, i + 1, 1_500_050));

  const durations: number[] = [];
  let ok = 0;
  for (const [i, client] of seeded.entries()) {
    const start = performance.now();
    ok += await processEmails(ctx, [
      {
        messageId: `<rendimiento-${i}-${Date.now()}@aldebaran.invalid>`,
        from: client.billingEmail,
        subject: 'Pago de la factura',
        bodyText: 'Adjunto el comprobante de pago.',
        receivedAt: now,
        attachments: [{ ...options.attachment(i), inline: false }],
      },
    ]);
    durations.push(performance.now() - start);
  }
  const p95Ms = percentile(durations, 0.95);
  return {
    name: 'emails',
    items: options.emails,
    ok,
    durationMs: durations.reduce((sum, d) => sum + d, 0),
    p95Ms,
    limitMs: EMAIL_LIMIT_MS,
    passed: ok === options.emails && p95Ms < EMAIL_LIMIT_MS,
  };
}
