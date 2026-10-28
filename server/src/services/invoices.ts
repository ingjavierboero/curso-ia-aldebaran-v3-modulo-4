import { and, asc, desc, eq, ne, type SQL } from 'drizzle-orm';
import type { AppContext } from '../context.ts';
import type { Db } from '../db/client.ts';
import { clients, invoiceItems, invoices, invoiceStatusChanges, users } from '../db/schema.ts';
import { formatVoucherNumber } from '../documents/format.ts';
import type { InvoiceDetailDto, InvoiceDto, InvoiceStatus } from '../http/types.ts';
import { invoicePdf } from './invoice-email.ts';
import { emailsOfInvoice, InvoiceNotFoundError } from './review.ts';

type Invoice = typeof invoices.$inferSelect;

export interface InvoiceFilters {
  status?: InvoiceStatus;
  clientId?: number;
  period?: string;
}

const toDto = (invoice: Invoice, clientName: string): InvoiceDto => ({
  id: invoice.id,
  clientId: invoice.clientId,
  clientName,
  period: invoice.period,
  pointOfSale: invoice.pointOfSale,
  number: invoice.number,
  voucherNumber: invoice.number === null ? null : formatVoucherNumber(invoice.pointOfSale, invoice.number),
  issueDate: invoice.issueDate,
  dueDate: invoice.dueDate,
  totalCents: invoice.totalCents,
  status: invoice.status as InvoiceStatus,
  cae: invoice.cae,
});

/**
 * Facturas emitidas (RF-160), de la más reciente a la más antigua, filtrables por estado, cliente y
 * período (RF-168). Las que todavía se están generando no se muestran.
 */
export function listInvoices(db: Db, filters: InvoiceFilters = {}): InvoiceDto[] {
  const conditions: SQL[] = [ne(invoices.status, 'generando')];
  if (filters.status) conditions.push(eq(invoices.status, filters.status));
  if (filters.clientId) conditions.push(eq(invoices.clientId, filters.clientId));
  if (filters.period) conditions.push(eq(invoices.period, filters.period));
  return db
    .select({ invoice: invoices, clientName: clients.businessName })
    .from(invoices)
    .innerJoin(clients, eq(invoices.clientId, clients.id))
    .where(and(...conditions))
    .orderBy(desc(invoices.issueDate), desc(invoices.id))
    .all()
    .map(({ invoice, clientName }) => toDto(invoice, clientName));
}

/** Factura emitida por id; una que todavía se está generando no existe para el usuario. */
function issuedInvoice(db: Db, id: number) {
  const row = db
    .select({ invoice: invoices, clientName: clients.businessName })
    .from(invoices)
    .innerJoin(clients, eq(invoices.clientId, clients.id))
    .where(and(eq(invoices.id, id), ne(invoices.status, 'generando')))
    .get();
  const invoice = row?.invoice;
  if (!row || !invoice || invoice.number === null || !invoice.cae || !invoice.caeDueDate) {
    throw new InvoiceNotFoundError('La factura no existe.');
  }
  return { ...row, invoice: { ...invoice, number: invoice.number, cae: invoice.cae, caeDueDate: invoice.caeDueDate } };
}

/**
 * Detalle de una factura (RF-217): sus datos, cada cuota, el link al PDF, sus cambios de estado en orden
 * cronológico con el usuario o el agente que los originó y los emails asociados con sus adjuntos.
 */
export function invoiceDetail(db: Db, id: number): InvoiceDetailDto {
  const { invoice, clientName } = issuedInvoice(db, id);
  const items = db
    .select()
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, id))
    .orderBy(asc(invoiceItems.id))
    .all();
  const changes = db
    .select({ change: invoiceStatusChanges, userName: users.name })
    .from(invoiceStatusChanges)
    .leftJoin(users, eq(users.id, invoiceStatusChanges.userId))
    .where(eq(invoiceStatusChanges.invoiceId, id))
    .orderBy(asc(invoiceStatusChanges.changedAt), asc(invoiceStatusChanges.id))
    .all();
  return {
    invoice: toDto(invoice, clientName),
    pdfUrl: `/api/invoices/${id}/pdf`,
    items: items.map((item) => ({
      description: item.description,
      originalPriceCents: item.originalPriceCents,
      originalCurrency: item.originalCurrency,
      amountCents: item.amountCents,
    })),
    statusChanges: changes.map(({ change, userName }) => ({
      fromStatus: change.fromStatus,
      toStatus: change.toStatus,
      reason: change.reason,
      actor: { type: change.actorType, userId: change.userId, userName: userName ?? null },
      changedAt: change.changedAt,
    })),
    emails: emailsOfInvoice(db, id),
  };
}

/** PDF de una factura emitida, para descargarlo desde el listado (RF-162). */
export function invoicePdfOf(ctx: AppContext, id: number) {
  return invoicePdf(ctx, issuedInvoice(ctx.db, id).invoice);
}
