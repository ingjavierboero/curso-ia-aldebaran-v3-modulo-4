import { eq } from 'drizzle-orm';
import type { AppContext } from '../context.ts';
import type { Db } from '../db/client.ts';
import { billingPeriods } from '../db/schema.ts';
import { currentPeriod } from '../domain/billing-dates.ts';
import type { BillingStatusDto } from '../http/types.ts';
import { type BillingRunSummary, runBilling } from './billing.ts';

export type BillingPeriod = typeof billingPeriods.$inferSelect;

/** Acción sobre el período que su estado no permite; `code` es el código de error de la API. */
export class BillingPeriodError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** RF-60, RF-61: por qué "Facturar ahora" está deshabilitado, según el estado del período. */
const DISABLED_REASONS: Partial<Record<BillingPeriod['status'], { code: string; reason: string }>> = {
  cancelado: { code: 'facturacion_cancelada', reason: 'la facturación del mes está cancelada' },
  en_curso: { code: 'facturacion_en_curso', reason: 'facturación en curso' },
  completado: { code: 'facturacion_realizada', reason: 'facturación del mes ya realizada' },
};

const findPeriod = (db: Db, period: string) =>
  db.select().from(billingPeriods).where(eq(billingPeriods.period, period)).get();

/** Período del mes en curso en Argentina y su fila, si ya existe. */
function current(ctx: AppContext) {
  const period = currentPeriod(ctx.adapters.clock.now());
  return { period, row: findPeriod(ctx.db, period) };
}

/** Estado del período del mes en curso y del botón "Facturar ahora" (RF-60, RF-61). */
export function billingStatus(ctx: AppContext): BillingStatusDto {
  const { period, row } = current(ctx);
  const status = row?.status ?? 'pendiente';
  const disabled = DISABLED_REASONS[status];
  return { period, status, billNow: { enabled: !disabled, reason: disabled?.reason ?? null } };
}

/**
 * RF-54: un Admin cancela la facturación del período del mes en curso mientras no haya empezado. Un
 * período cancelado no se factura (RF-55).
 */
export async function cancelBilling(ctx: AppContext, userId: number): Promise<BillingStatusDto> {
  const { period, row } = current(ctx);
  if (row?.status === 'en_curso' || row?.status === 'completado') {
    throw new BillingPeriodError(
      'facturacion_iniciada',
      'La facturación del período ya empezó: no se puede cancelar.',
    );
  }
  const cancellation = {
    status: 'cancelado' as const,
    cancelledByUserId: userId,
    cancelledAt: ctx.adapters.clock.now().toISOString(),
  };
  if (row) ctx.db.update(billingPeriods).set(cancellation).where(eq(billingPeriods.id, row.id)).run();
  else ctx.db.insert(billingPeriods).values({ period, ...cancellation }).run();
  return billingStatus(ctx);
}

/**
 * RF-56: un Admin reactiva la facturación del período cancelado mientras siga siendo su mes. Si ya pasó
 * la hora de facturación del día 15, la corrida arranca en el tick siguiente del agente (RF-57).
 */
export async function reactivateBilling(ctx: AppContext, userId: number): Promise<BillingStatusDto> {
  const { row } = current(ctx);
  if (row?.status !== 'cancelado') {
    throw new BillingPeriodError('periodo_no_cancelado', 'La facturación del mes en curso no está cancelada.');
  }
  ctx.db
    .update(billingPeriods)
    .set({ status: 'pendiente', reactivatedByUserId: userId, reactivatedAt: ctx.adapters.clock.now().toISOString() })
    .where(eq(billingPeriods.id, row.id))
    .run();
  return billingStatus(ctx);
}

/**
 * RF-58, RF-59: "Facturar ahora" ejecuta la facturación del período del mes en curso con las mismas
 * reglas que la del día 15. Valida y pone el período en curso de forma sincrónica, antes de lanzar la
 * corrida: si no corresponde, lanza BillingPeriodError sin generar nada (AC-59, AC-60), y dos pedidos
 * seguidos no disparan dos corridas. Devuelve la corrida, que termina cuando se intentó facturar a todos.
 */
export function billNow(ctx: AppContext, _userId: number): Promise<BillingRunSummary> {
  const { period, row } = current(ctx);
  const disabled = row ? DISABLED_REASONS[row.status] : undefined;
  if (disabled) throw new BillingPeriodError(disabled.code, `No se puede facturar ahora: ${disabled.reason}.`);

  const start = {
    status: 'en_curso' as const,
    triggeredBy: 'facturar_ahora' as const,
    startedAt: ctx.adapters.clock.now().toISOString(),
  };
  if (row) ctx.db.update(billingPeriods).set(start).where(eq(billingPeriods.id, row.id)).run();
  else ctx.db.insert(billingPeriods).values({ period, ...start }).run();
  return runBilling(ctx, { period, triggeredBy: 'facturar_ahora' });
}
