import { eq } from 'drizzle-orm';
import type { AppContext } from '../context.ts';
import { billingPeriods } from '../db/schema.ts';
import { argentinaParts, currentPeriod, isAtOrAfterTime } from '../domain/billing-dates.ts';
import { type BillingTrigger, isBillingRunning, runBilling } from '../services/billing.ts';
import { getSettings } from '../services/settings.ts';
import type { ScheduledProcess } from './scheduler.ts';

/** Qué período facturar en este tick y por qué, o null si no corresponde facturar. */
function nextRun(ctx: AppContext, now: Date): { period: string; triggeredBy: BillingTrigger } | null {
  const { db } = ctx;

  // RF-53: un período que quedó en curso (por ejemplo, por un reinicio) se retoma siempre, aunque ya sea
  // el mes siguiente; salvo que su corrida siga en marcha en este proceso ("Facturar ahora").
  const interrupted = db.select().from(billingPeriods).where(eq(billingPeriods.status, 'en_curso')).get();
  if (interrupted) {
    return isBillingRunning(db, interrupted.period)
      ? null
      : { period: interrupted.period, triggeredBy: 'agente_recuperacion' };
  }

  // Solo se factura el período del mes en curso: uno anterior que nunca empezó no se factura (RF-52).
  const period = currentPeriod(now);
  const row = db.select().from(billingPeriods).where(eq(billingPeriods.period, period)).get();
  if (row && row.status !== 'pendiente') return null; // cancelado (RF-55) o ya facturado (RF-59)

  // RF-51, RF-52: el día 15 desde la hora de facturación, o cualquier día posterior del mes (el sistema
  // estaba detenido el 15, o se reactivó la facturación, RF-57).
  const { day } = argentinaParts(now);
  const due = day > 15 || (day === 15 && isAtOrAfterTime(now, getSettings(db).billingTime));
  if (!due) return null;
  if (row?.reactivatedAt) return { period, triggeredBy: 'reactivacion' };
  return { period, triggeredBy: day === 15 ? 'agente_dia_15' : 'agente_recuperacion' };
}

/**
 * Proceso de facturación que el tick evalúa cada minuto (research R-04): factura el período del mes en
 * curso el día 15 a la hora de facturación de Argentina, recupera lo que no se facturó por una caída y
 * retoma una corrida interrumpida.
 */
export function createBillingJob(ctx: AppContext): ScheduledProcess {
  return {
    name: 'facturacion',
    shouldRun: (now) => nextRun(ctx, now) !== null,
    async run(now) {
      const next = nextRun(ctx, now);
      if (next) await runBilling(ctx, next);
    },
  };
}
