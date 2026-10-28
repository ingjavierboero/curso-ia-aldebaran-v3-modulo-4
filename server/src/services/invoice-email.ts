import { and, eq, inArray } from 'drizzle-orm';
import type { AppContext } from '../context.ts';
import { clients, exchangeRates, invoiceItems, invoices, sentEmails } from '../db/schema.ts';
import { OWED_STATUSES } from '../domain/invoice-status.ts';
import { invoiceEmail } from '../documents/email-templates.ts';
import { formatVoucherNumber } from '../documents/format.ts';
import { type InvoicePdfData, renderInvoicePdf } from '../documents/invoice-pdf.ts';
import { recordClientEvent } from './history.ts';
import { getSettings } from './settings.ts';

export type InvoiceEmailTrigger = (typeof sentEmails.$inferSelect)['trigger'];

export type InvoiceEmailResult =
  | { status: 'enviado' }
  | { status: 'omitido'; reason: string }
  | { status: 'fallido'; message: string };

/** Deuda vigente del cliente: la suma de sus facturas adeudadas, al momento del envío (RF-88). */
function currentDebt(ctx: AppContext, clientId: number, invoiceId: number) {
  const owed = ctx.db
    .select({ id: invoices.id, totalCents: invoices.totalCents })
    .from(invoices)
    .where(and(eq(invoices.clientId, clientId), inArray(invoices.status, [...OWED_STATUSES])))
    .all();
  return {
    debtCents: owed.reduce((sum, invoice) => sum + invoice.totalCents, 0),
    includesPrevious: owed.some((invoice) => invoice.id !== invoiceId),
  };
}

/**
 * Envía el email de una factura ya generada con su PDF adjunto (RF-84 a RF-90, RF-93, RF-215). La deuda
 * vigente se calcula en cada intento; la factura y su PDF no cambian (RF-88). Va al email de facturación
 * vigente del cliente y nunca a un cliente Inactivo (RF-96). El envío queda registrado en `sent_emails` y
 * en el historial del cliente (AC-78). Lo usan la corrida y los reintentos de envío (RF-86).
 */
export async function sendInvoiceEmail(
  ctx: AppContext,
  invoiceId: number,
  trigger: InvoiceEmailTrigger,
  userId?: number,
): Promise<InvoiceEmailResult> {
  const { db, adapters, env } = ctx;
  const invoice = db.select().from(invoices).where(eq(invoices.id, invoiceId)).get();
  if (!invoice || invoice.status === 'generando' || !invoice.cae || !invoice.caeDueDate || invoice.number === null) {
    return { status: 'omitido', reason: 'la factura todavía no tiene CAE' };
  }
  const client = db.select().from(clients).where(eq(clients.id, invoice.clientId)).get();
  if (!client || client.status !== 'activo') return { status: 'omitido', reason: 'el cliente está Inactivo' };

  const items = db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id)).all();
  const rate = invoice.exchangeRateId
    ? db.select().from(exchangeRates).where(eq(exchangeRates.id, invoice.exchangeRateId)).get()
    : undefined;
  const pdfData: InvoicePdfData = {
    mode: env.mode,
    issuer: invoice.issuerSnapshot as InvoicePdfData['issuer'],
    client: invoice.clientSnapshot as InvoicePdfData['client'],
    voucherType: 11,
    pointOfSale: invoice.pointOfSale,
    number: invoice.number,
    issueDate: invoice.issueDate,
    period: invoice.period,
    serviceFrom: invoice.serviceFrom,
    serviceTo: invoice.serviceTo,
    dueDate: invoice.dueDate,
    items,
    totalCents: invoice.totalCents,
    cae: invoice.cae,
    caeDueDate: invoice.caeDueDate,
    exchangeRate: rate ? { rateCents: rate.rateCents, source: rate.source, readAt: rate.readAt } : null,
  };

  const settings = getSettings(db);
  const voucherNumber = formatVoucherNumber(invoice.pointOfSale, invoice.number);
  const email = invoiceEmail({
    mode: env.mode,
    to: client.billingEmail,
    clientName: client.businessName,
    senderName: settings.issuerTradeName || settings.issuerBusinessName || client.businessName,
    voucherNumber,
    period: invoice.period,
    totalCents: invoice.totalCents,
    dueDate: invoice.dueDate,
    ...currentDebt(ctx, client.id, invoice.id),
    pdf: { filename: `factura-C-${voucherNumber}.pdf`, content: await renderInvoicePdf(pdfData) },
  });

  try {
    await adapters.mailSender.send(email);
  } catch (error) {
    return { status: 'fallido', message: error instanceof Error ? error.message : 'error desconocido' };
  }

  const now = adapters.clock.now();
  db.transaction((tx) => {
    tx.insert(sentEmails)
      .values({
        kind: 'factura',
        trigger,
        clientId: client.id,
        invoiceId: invoice.id,
        toAddress: email.to,
        subject: email.subject,
        body: email.text,
        sentAt: now.toISOString(),
        sentByUserId: userId ?? null,
      })
      .run();
    recordClientEvent(tx, {
      clientId: client.id,
      type: 'email_enviado',
      payload: { kind: 'factura', trigger, to: email.to, subject: email.subject, invoiceId: invoice.id },
      actor: userId ? { type: 'usuario', userId } : { type: 'agente' },
      at: now,
    });
  });
  return { status: 'enviado' };
}
