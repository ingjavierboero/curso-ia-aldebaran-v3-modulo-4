import { and, asc, count, eq, isNull } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Conn, Db } from '../db/client.ts';
import { clients, invoices, processErrors } from '../db/schema.ts';
import { formatVoucherNumber } from '../documents/format.ts';
import type { ProcessErrorDto } from '../http/types.ts';
import { recordClientEvent } from './history.ts';

export class ProcessErrorNotFoundError extends Error {}
/** El error ya está Resuelto: no se reintenta ni se resuelve otra vez. */
export class ProcessErrorResolvedError extends Error {}

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
 * duplicarlo.
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

/**
 * Pasa a Resuelto los errores Pendientes de una operación sin cliente, por ejemplo el de revisión de la
 * casilla cuando vuelve a estar disponible (RF-106).
 */
export function resolveProcessErrors(conn: Conn, operation: ProcessOperation, now: Date): void {
  const at = now.toISOString();
  conn
    .update(processErrors)
    .set({ status: 'resuelto', resolvedBy: 'agente', resolvedAt: at, updatedAt: at })
    .where(and(eq(processErrors.status, 'pendiente'), eq(processErrors.operation, operation)))
    .run();
}

/** Errores de proceso Pendientes, del más antiguo al más reciente (RF-175). */
export function listPendingErrors(db: Db): ProcessErrorDto[] {
  return db
    .select({ error: processErrors, clientName: clients.businessName, invoice: invoices })
    .from(processErrors)
    .leftJoin(clients, eq(clients.id, processErrors.clientId))
    .leftJoin(invoices, eq(invoices.id, processErrors.invoiceId))
    .where(eq(processErrors.status, 'pendiente'))
    .orderBy(asc(processErrors.createdAt), asc(processErrors.id))
    .all()
    .map(({ error, clientName, invoice }) => ({
      id: error.id,
      operation: error.operation,
      clientId: error.clientId,
      clientName,
      period: error.period,
      invoiceId: error.invoiceId,
      voucherNumber: invoice?.number != null ? formatVoucherNumber(invoice.pointOfSale, invoice.number) : null,
      attempts: error.attempts,
      lastErrorMessage: error.lastErrorMessage,
      createdAt: error.createdAt,
      updatedAt: error.updatedAt,
    }));
}

/** Cantidad de errores Pendientes, para el banner de errores (RF-181). */
export function pendingErrorCount(db: Db): number {
  return db.select({ n: count() }).from(processErrors).where(eq(processErrors.status, 'pendiente')).get()?.n ?? 0;
}

/** Error Pendiente por id; si no existe o ya está Resuelto, el error correspondiente. */
export function pendingError(conn: Conn, id: number): ProcessError {
  const error = conn.select().from(processErrors).where(eq(processErrors.id, id)).get();
  if (!error) throw new ProcessErrorNotFoundError('El error de proceso no existe.');
  if (error.status !== 'pendiente') throw new ProcessErrorResolvedError('El error de proceso ya está Resuelto.');
  return error;
}

/**
 * Pasa un error Pendiente a Resuelto (RF-179, RF-180): por un usuario que lo marca o por un reintento
 * manual exitoso, y registra quién lo resolvió (AC-191).
 */
export function resolveProcessError(
  conn: Conn,
  id: number,
  input: { by: 'usuario' | 'reintento_manual'; userId: number; now: Date },
): void {
  pendingError(conn, id);
  const at = input.now.toISOString();
  conn
    .update(processErrors)
    .set({ status: 'resuelto', resolvedBy: input.by, resolvedByUserId: input.userId, resolvedAt: at, updatedAt: at })
    .where(eq(processErrors.id, id))
    .run();
}

/** Un reintento manual falló: el error sigue Pendiente con un intento más y el nuevo mensaje (AC-190). */
export function recordFailedRetry(conn: Conn, id: number, message: string, now: Date): void {
  const error = pendingError(conn, id);
  conn
    .update(processErrors)
    .set({ attempts: error.attempts + 1, lastErrorMessage: message, updatedAt: now.toISOString() })
    .where(eq(processErrors.id, id))
    .run();
}
