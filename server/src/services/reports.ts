import { and, asc, eq, gte, inArray, lte, ne, type SQL, sql, sum } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { clients, invoices } from '../db/schema.ts';
import { OWED_STATUSES } from '../domain/invoice-status.ts';
import { formatVoucherNumber } from '../documents/format.ts';
import type { BillingReportRow, CollectionsReportRow, DebtReportRow, InvoiceStatus } from '../http/types.ts';

/** Rango de períodos `YYYY-MM`, con las dos puntas incluidas; cada una es opcional (RF-170). */
export interface PeriodRange {
  from?: string;
  to?: string;
}

/** Facturas emitidas del rango: las que todavía se están generando no cuentan. */
function issuedInRange(range: PeriodRange): SQL | undefined {
  const conditions: SQL[] = [ne(invoices.status, 'generando')];
  if (range.from) conditions.push(gte(invoices.period, range.from));
  if (range.to) conditions.push(lte(invoices.period, range.to));
  return and(...conditions);
}

const cents = (column: Parameters<typeof sum>[0]) => sql<number>`coalesce(${sum(column)}, 0)`.mapWith(Number);

/** Total de las facturas en esos estados, por período. */
function totalWhere(statuses: InvoiceStatus[]) {
  const inStatuses = inArray(invoices.status, statuses);
  return sql<number>`coalesce(sum(case when ${inStatuses} then ${invoices.totalCents} else 0 end), 0)`.mapWith(Number);
}

/** Reporte de facturación (RF-164): por período, la cantidad de facturas emitidas y su total. */
export function billingReport(db: Db, range: PeriodRange = {}): BillingReportRow[] {
  return db
    .select({
      period: invoices.period,
      invoiceCount: sql<number>`count(*)`.mapWith(Number),
      totalCents: cents(invoices.totalCents),
    })
    .from(invoices)
    .where(issuedInRange(range))
    .groupBy(invoices.period)
    .orderBy(asc(invoices.period))
    .all();
}

/**
 * Reporte de cobranza (RF-165): por período, el total facturado y cuánto de ese total está Pagada, en
 * Pago recibido y adeudado (Pendiente de pago y Revisión manual).
 */
export function collectionsReport(db: Db, range: PeriodRange = {}): CollectionsReportRow[] {
  return db
    .select({
      period: invoices.period,
      totalCents: cents(invoices.totalCents),
      paidCents: totalWhere(['pagada']),
      paymentReceivedCents: totalWhere(['pago_recibido']),
      owedCents: totalWhere([...OWED_STATUSES] as InvoiceStatus[]),
    })
    .from(invoices)
    .where(issuedInRange(range))
    .groupBy(invoices.period)
    .orderBy(asc(invoices.period))
    .all();
}

/**
 * Reporte de deuda (RF-166): cada cliente con deuda vigente, su total y sus facturas adeudadas de la más
 * antigua a la más reciente. Los clientes van de la mayor deuda a la menor.
 */
export function debtReport(db: Db): DebtReportRow[] {
  const rows = db
    .select({ invoice: invoices, businessName: clients.businessName })
    .from(invoices)
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .where(inArray(invoices.status, [...OWED_STATUSES]))
    .orderBy(asc(invoices.period), asc(invoices.id))
    .all();

  const byClient = new Map<number, DebtReportRow>();
  for (const { invoice, businessName } of rows) {
    const row = byClient.get(invoice.clientId) ?? {
      clientId: invoice.clientId,
      businessName,
      debtCents: 0,
      invoices: [],
    };
    row.debtCents += invoice.totalCents;
    row.invoices.push({
      invoiceId: invoice.id,
      voucherNumber: invoice.number === null ? null : formatVoucherNumber(invoice.pointOfSale, invoice.number),
      period: invoice.period,
      totalCents: invoice.totalCents,
      dueDate: invoice.dueDate,
      status: invoice.status as InvoiceStatus,
    });
    byClient.set(invoice.clientId, row);
  }
  return [...byClient.values()].sort(
    (a, b) => b.debtCents - a.debtCents || a.businessName.localeCompare(b.businessName, 'es'),
  );
}
