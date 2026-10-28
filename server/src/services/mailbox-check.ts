import { desc, eq, min, ne } from 'drizzle-orm';
import type { AppContext } from '../context.ts';
import type { Db } from '../db/client.ts';
import { invoices, mailboxChecks } from '../db/schema.ts';
import { startOfArgentinaDay } from '../domain/billing-dates.ts';
import { processEmails } from './payment-processing.ts';
import { recordProcessError, resolveProcessErrors } from './process-errors.ts';

/** Fecha de emisión de la primera factura emitida (con CAE), o null si todavía no hay ninguna. */
export function firstIssueDate(db: Db): string | null {
  const row = db
    .select({ first: min(invoices.issueDate) })
    .from(invoices)
    .where(ne(invoices.status, 'generando'))
    .get();
  return row?.first ?? null;
}

/** Inicio de la última revisión de la casilla, exitosa o no, para contar el intervalo (RF-101). */
export function lastCheckStartedAt(db: Db): Date | null {
  const row = db
    .select({ startedAt: mailboxChecks.startedAt })
    .from(mailboxChecks)
    .orderBy(desc(mailboxChecks.id))
    .get();
  return row ? new Date(row.startedAt) : null;
}

/**
 * Desde cuándo leer la casilla (RF-107, RF-108): desde el inicio de la última revisión exitosa o, en la
 * primera, desde el día de la primera factura. Después de una falla se lee desde la última exitosa, así
 * se procesan los emails que llegaron mientras la casilla no estaba disponible (RF-105).
 */
function cutoff(db: Db, firstIssue: string): Date {
  const lastSuccess = db
    .select({ startedAt: mailboxChecks.startedAt })
    .from(mailboxChecks)
    .where(eq(mailboxChecks.success, true))
    .orderBy(desc(mailboxChecks.id))
    .get();
  return lastSuccess ? new Date(lastSuccess.startedAt) : startOfArgentinaDay(firstIssue);
}

/**
 * Revisión de la casilla (RF-99 a RF-109): la registra, lee los emails desde la fecha de corte y los
 * procesa. Si la casilla falla, deja un único error de proceso Pendiente de revisión de la casilla
 * (RF-103); cuando vuelve a funcionar, lo pasa a Resuelto (RF-106). Sin facturas emitidas no hace nada.
 */
export async function checkMailbox(ctx: AppContext): Promise<void> {
  const { db, adapters } = ctx;
  const firstIssue = firstIssueDate(db);
  if (!firstIssue) return;

  const startedAt = adapters.clock.now();
  const check = db.insert(mailboxChecks).values({ startedAt: startedAt.toISOString() }).returning().get();
  const finish = (values: { success: boolean; emailsDetected?: number }) =>
    db.update(mailboxChecks)
      .set({ ...values, finishedAt: adapters.clock.now().toISOString() })
      .where(eq(mailboxChecks.id, check.id))
      .run();

  try {
    const emails = await adapters.mailbox.fetchSince(cutoff(db, firstIssue));
    await processEmails(ctx, emails);
    finish({ success: true, emailsDetected: emails.length });
    resolveProcessErrors(db, 'revision_casilla', adapters.clock.now());
  } catch (error) {
    finish({ success: false });
    recordProcessError(db, {
      operation: 'revision_casilla',
      attempts: 1,
      message: error instanceof Error ? error.message : 'error desconocido',
      now: adapters.clock.now(),
    });
  }
}
