import { and, eq, isNull } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Conn } from '../db/client.ts';
import { processErrors } from '../db/schema.ts';
import { recordClientEvent } from './history.ts';

export type ProcessError = typeof processErrors.$inferSelect;
export type ProcessOperation = ProcessError['operation'];

export interface NewProcessError {
  operation: ProcessOperation;
  clientId?: number | null;
  period?: string | null;
  invoiceId?: number | null;
  /** Intentos hechos en esta ejecución (1 sin reintentos automáticos). */
  attempts: number;
  /** Último mensaje de error, sin secretos (Constitución IV). */
  message: string;
  now: Date;
}

/** Igual a un valor, o nulo si no corresponde. */
const sameOrNull = (column: SQLiteColumn, value: string | number | null | undefined) =>
  value === null || value === undefined ? isNull(column) : eq(column, value);

/**
 * RF-174: registra un error de proceso Pendiente con la operación, los intentos, el último mensaje y,
 * cuando corresponde, el cliente y el período; el de un cliente queda también en su historial (RF-163).
 * Si ya hay uno Pendiente de la misma operación, cliente, período y factura, lo actualiza en vez de
 * duplicarlo. Los reintentos automáticos y manuales se agregan en US7.
 */
export function recordProcessError(conn: Conn, error: NewProcessError): ProcessError {
  const at = error.now.toISOString();
  const existing = conn
    .select()
    .from(processErrors)
    .where(
      and(
        eq(processErrors.status, 'pendiente'),
        eq(processErrors.operation, error.operation),
        sameOrNull(processErrors.clientId, error.clientId),
        sameOrNull(processErrors.period, error.period),
        sameOrNull(processErrors.invoiceId, error.invoiceId),
      ),
    )
    .get();

  const saved = existing
    ? (conn
        .update(processErrors)
        .set({ attempts: existing.attempts + error.attempts, lastErrorMessage: error.message, updatedAt: at })
        .where(eq(processErrors.id, existing.id))
        .returning()
        .get() as ProcessError)
    : conn
        .insert(processErrors)
        .values({
          operation: error.operation,
          clientId: error.clientId ?? null,
          period: error.period ?? null,
          invoiceId: error.invoiceId ?? null,
          attempts: error.attempts,
          lastErrorMessage: error.message,
          status: 'pendiente',
          createdAt: at,
          updatedAt: at,
        })
        .returning()
        .get();

  if (error.clientId) {
    recordClientEvent(conn, {
      clientId: error.clientId,
      type: 'error_proceso',
      payload: {
        operation: error.operation,
        period: error.period ?? null,
        message: error.message,
        attempts: error.attempts,
      },
      actor: { type: 'agente' },
      at: error.now,
    });
  }
  return saved;
}
