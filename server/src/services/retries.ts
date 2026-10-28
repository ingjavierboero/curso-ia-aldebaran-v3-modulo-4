import { eq } from 'drizzle-orm';
import type { Conn } from '../db/client.ts';
import { retryQueue } from '../db/schema.ts';
import { recordProcessError } from './process-errors.ts';
import { getSettings } from './settings.ts';

export type RetryEntry = typeof retryQueue.$inferSelect;
export type RetryOperation = RetryEntry['operation'];

/** Operación automática que falló, con lo necesario para volver a intentarla. */
export interface FailedOperation {
  operation: RetryOperation;
  clientId: number;
  /** Período de la factura o mes del recordatorio (`YYYY-MM`). */
  period: string;
  invoiceId?: number | null;
  /** Intentos hechos hasta ahora, contando el que acaba de fallar. */
  attempts: number;
  message: string;
  now: Date;
  /** Entrada de la cola de este reintento, si la falla vino de uno. */
  entryId?: number;
}

/**
 * Decide qué pasa con una operación automática que falló (RF-171, RF-174, research R-11): si quedan
 * reintentos según la configuración, la deja en la cola para dentro de la espera configurada; si no,
 * registra el error de proceso Pendiente con la cantidad de intentos. La cola guarda el intento, así un
 * reinicio la retoma donde estaba.
 */
export function retryOrFail(conn: Conn, failure: FailedOperation): void {
  const { retryCount, retryWaitMinutes } = getSettings(conn);
  if (failure.attempts > retryCount) {
    if (failure.entryId) conn.delete(retryQueue).where(eq(retryQueue.id, failure.entryId)).run();
    recordProcessError(conn, {
      operation: failure.operation,
      clientId: failure.clientId,
      period: failure.period,
      invoiceId: failure.invoiceId ?? null,
      attempts: failure.attempts,
      message: failure.message,
      now: failure.now,
    });
    return;
  }

  const values = {
    attempt: failure.attempts,
    nextAttemptAt: new Date(failure.now.getTime() + retryWaitMinutes * 60_000).toISOString(),
    lastError: failure.message,
  };
  if (failure.entryId) {
    conn.update(retryQueue).set(values).where(eq(retryQueue.id, failure.entryId)).run();
  } else {
    conn.insert(retryQueue)
      .values({
        ...values,
        operation: failure.operation,
        clientId: failure.clientId,
        period: failure.period,
        invoiceId: failure.invoiceId ?? null,
      })
      .run();
  }
}
