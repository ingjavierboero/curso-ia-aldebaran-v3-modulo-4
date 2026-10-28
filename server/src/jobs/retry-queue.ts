import { asc, eq, lte } from 'drizzle-orm';
import type { AppContext } from '../context.ts';
import { retryQueue } from '../db/schema.ts';
import { generateInvoice } from '../services/billing.ts';
import { recordClientEvent } from '../services/history.ts';
import { sendInvoiceEmail } from '../services/invoice-email.ts';
import { recordProcessError } from '../services/process-errors.ts';
import { ReminderBlockedError, sendReminder } from '../services/reminders.ts';
import { type RetryEntry, retryOrFail } from '../services/retries.ts';
import type { ScheduledProcess } from './scheduler.ts';

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : 'error desconocido');

const due = (ctx: AppContext, now: Date) =>
  ctx.db
    .select()
    .from(retryQueue)
    .where(lte(retryQueue.nextAttemptAt, now.toISOString()))
    .orderBy(asc(retryQueue.nextAttemptAt), asc(retryQueue.id))
    .all();

const done = (ctx: AppContext, entry: RetryEntry) => ctx.db.delete(retryQueue).where(eq(retryQueue.id, entry.id)).run();

/** Vuelve a dejar la entrada en la cola, o registra el error de proceso si no quedan reintentos. */
function failed(ctx: AppContext, entry: RetryEntry, message: string) {
  ctx.db.transaction((tx) =>
    retryOrFail(tx, {
      operation: entry.operation,
      clientId: entry.clientId ?? 0,
      period: entry.period ?? '',
      invoiceId: entry.invoiceId,
      attempts: entry.attempt + 1,
      message,
      now: ctx.adapters.clock.now(),
      entryId: entry.id,
    }),
  );
}

/**
 * Generación: cada reintento usa los datos vigentes (RF-171). Si la factura se genera, el email sale en
 * el momento, con su propia cuenta de reintentos (RF-85, RF-86); un rechazo de ARCA o un cliente que ya
 * no es facturable no se reintenta: queda el error de proceso enseguida.
 */
async function retryGeneration(ctx: AppContext, entry: RetryEntry) {
  const clientId = entry.clientId ?? 0;
  const period = entry.period ?? '';
  const result = await generateInvoice(ctx, { clientId, period });
  if (result.status === 'fallida') {
    if (result.retryable) return failed(ctx, entry, result.message);
    done(ctx, entry);
    recordProcessError(ctx.db, {
      operation: 'generacion_factura',
      clientId,
      period,
      attempts: entry.attempt + 1,
      message: result.message,
      now: ctx.adapters.clock.now(),
    });
    return;
  }
  done(ctx, entry);
  const sent = await sendInvoiceEmail(ctx, result.invoiceId, 'automatico');
  if (sent.status === 'fallido') {
    retryOrFail(ctx.db, {
      operation: 'envio_factura',
      clientId,
      period,
      invoiceId: result.invoiceId,
      attempts: 1,
      message: sent.message,
      now: ctx.adapters.clock.now(),
    });
  }
}

/** Envío de factura: reenvía el email sin volver a generar la factura (RF-86). */
async function retryInvoiceEmail(ctx: AppContext, entry: RetryEntry) {
  const sent = await sendInvoiceEmail(ctx, entry.invoiceId ?? 0, 'automatico');
  // Omitido: la factura o el cliente ya no corresponden (por ejemplo, un cliente dado de baja, RF-96).
  if (sent.status === 'fallido') failed(ctx, entry, sent.message);
  else done(ctx, entry);
}

/**
 * Recordatorio: se arma con la deuda del momento. Si el cliente ya no tiene deuda vigente, está en
 * revisión o está Inactivo, se cancela sin error y queda en su historial (RF-171, AC-247).
 */
async function retryReminder(ctx: AppContext, entry: RetryEntry) {
  const clientId = entry.clientId ?? 0;
  try {
    await sendReminder(ctx, { clientId, trigger: 'automatico', reminderMonth: entry.period ?? undefined });
    done(ctx, entry);
  } catch (error) {
    if (!(error instanceof ReminderBlockedError)) return failed(ctx, entry, errorMessage(error));
    ctx.db.transaction((tx) => {
      tx.delete(retryQueue).where(eq(retryQueue.id, entry.id)).run();
      recordClientEvent(tx, {
        clientId,
        type: 'recordatorio_cancelado',
        payload: { month: entry.period, reason: error.message },
        actor: { type: 'agente' },
        at: ctx.adapters.clock.now(),
      });
    });
  }
}

const HANDLERS: Record<RetryEntry['operation'], (ctx: AppContext, entry: RetryEntry) => Promise<void>> = {
  generacion_factura: retryGeneration,
  envio_factura: retryInvoiceEmail,
  envio_recordatorio: retryReminder,
};

/**
 * Cola de reintentos que el tick evalúa cada minuto (research R-04, R-11): ejecuta, de a uno y en orden,
 * los reintentos cuya hora llegó. Está persistida en `retry_queue`, así sobrevive a los reinicios.
 */
export function createRetryQueueJob(ctx: AppContext): ScheduledProcess {
  return {
    name: 'reintentos',
    shouldRun: (now) => due(ctx, now).length > 0,
    async run(now) {
      for (const entry of due(ctx, now)) {
        try {
          await HANDLERS[entry.operation](ctx, entry);
        } catch (error) {
          failed(ctx, entry, errorMessage(error));
        }
      }
    },
  };
}
