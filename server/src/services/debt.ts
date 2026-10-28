import { asc, count, desc, eq, inArray, sql, sum } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { clients, invoices } from '../db/schema.ts';
import { OWED_STATUSES } from '../domain/invoice-status.ts';
import type { DebtorDto } from '../http/types.ts';

/**
 * Clientes con deuda vigente (RF-153): su deuda total, la cantidad de facturas adeudadas y si están en
 * revisión, de la mayor deuda a la menor. Incluye a los Inactivos que todavía deben algo.
 */
export function listDebtors(db: Db): DebtorDto[] {
  const debt = sql<number>`${sum(invoices.totalCents)}`.mapWith(Number);
  return db
    .select({
      clientId: clients.id,
      businessName: clients.businessName,
      clientStatus: clients.status,
      debtCents: debt,
      owedInvoices: count(invoices.id),
      inReview: sql<number>`max(${invoices.status} = 'revision_manual')`.mapWith(Boolean),
    })
    .from(invoices)
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .where(inArray(invoices.status, [...OWED_STATUSES]))
    .groupBy(clients.id)
    .orderBy(desc(debt), asc(clients.businessName))
    .all();
}
