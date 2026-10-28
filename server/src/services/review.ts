import { and, asc, desc, eq, gte, inArray, lt, type SQL } from 'drizzle-orm';
import type { Conn, Db } from '../db/client.ts';
import {
  clients,
  invoiceEmails,
  invoices,
  invoiceStatusChanges,
  notices,
  receivedAttachments,
  receivedEmails,
  users,
} from '../db/schema.ts';
import { addDays, startOfArgentinaDay } from '../domain/billing-dates.ts';
import { canTransition, type InvoiceStatus } from '../domain/invoice-status.ts';
import { formatVoucherNumber } from '../documents/format.ts';
import type {
  InvoiceStatus as InvoiceStatusDto,
  NoticeDto,
  ReceivedEmailDto,
  ResolvedPaymentDto,
  ReviewInvoiceDto,
  ReviewPaymentDto,
} from '../http/types.ts';
import { recordClientEvent } from './history.ts';

export class InvoiceNotFoundError extends Error {}
export class NoticeNotFoundError extends Error {}
/** El usuario no puede hacer esa transición (por ejemplo, de Pagada a Pendiente de pago). */
export class UserTransitionError extends Error {}
/** La factura ya no está en el estado que vio el usuario (RF-218): `currentStatus` es el vigente. */
export class StatusConflictError extends Error {
  readonly currentStatus: InvoiceStatus;

  constructor(currentStatus: InvoiceStatus) {
    super('La factura cambió de estado mientras la mirabas: la pantalla se actualizó con el estado vigente.');
    this.currentStatus = currentStatus;
  }
}

/** Pagos a revisar: Pago recibido y Revisión manual (RF-141). */
const REVIEW_STATUSES: InvoiceStatus[] = ['pago_recibido', 'revision_manual'];

type InvoiceRow = typeof invoices.$inferSelect;

const toInvoiceDto = (invoice: InvoiceRow, clientName: string): ReviewInvoiceDto => ({
  id: invoice.id,
  clientId: invoice.clientId,
  clientName,
  period: invoice.period,
  voucherNumber: invoice.number === null ? null : formatVoucherNumber(invoice.pointOfSale, invoice.number),
  totalCents: invoice.totalCents,
  dueDate: invoice.dueDate,
  status: invoice.status as InvoiceStatusDto,
  reason: invoice.manualReviewReason,
});

/** Emails con sus adjuntos y el resultado del LLM de cada uno, en el orden de los ids recibidos. */
function emailsByIds(conn: Conn, ids: number[]): ReceivedEmailDto[] {
  if (ids.length === 0) return [];
  const attachments = conn
    .select()
    .from(receivedAttachments)
    .where(inArray(receivedAttachments.receivedEmailId, ids))
    .orderBy(asc(receivedAttachments.id))
    .all();
  const emails = conn.select().from(receivedEmails).where(inArray(receivedEmails.id, ids)).all();
  return ids.flatMap((id) => {
    const email = emails.find((e) => e.id === id);
    if (!email) return [];
    return [
      {
        id: email.id,
        from: email.fromAddress,
        subject: email.subject,
        receivedAt: email.receivedAt,
        classification: email.classification,
        attachments: attachments
          .filter((a) => a.receivedEmailId === id)
          .map((a) => ({
            id: a.id,
            filename: a.filename,
            mimeType: a.mimeType,
            classification: a.classification,
            cuit: a.extractedCuit,
            amountCents: a.extractedAmountCents,
            error: a.errorMessage,
          })),
      },
    ];
  });
}

/** Emails asociados a una factura (RF-139), del más antiguo al más reciente. */
export function emailsOfInvoice(conn: Conn, invoiceId: number): ReceivedEmailDto[] {
  const ids = conn
    .select({ id: receivedEmails.id })
    .from(invoiceEmails)
    .innerJoin(receivedEmails, eq(invoiceEmails.receivedEmailId, receivedEmails.id))
    .where(eq(invoiceEmails.invoiceId, invoiceId))
    .orderBy(asc(receivedEmails.receivedAt), asc(receivedEmails.id))
    .all()
    .map((row) => row.id);
  return emailsByIds(conn, ids);
}

/** RF-141: facturas en Pago recibido o Revisión manual con su evidencia, de la más antigua a la más reciente. */
export function listPayments(db: Db): ReviewPaymentDto[] {
  return db
    .select({ invoice: invoices, clientName: clients.businessName })
    .from(invoices)
    .innerJoin(clients, eq(invoices.clientId, clients.id))
    .where(inArray(invoices.status, REVIEW_STATUSES))
    .orderBy(asc(invoices.period), asc(invoices.id))
    .all()
    .map(({ invoice, clientName }) => ({
      invoice: toInvoiceDto(invoice, clientName),
      emails: emailsOfInvoice(db, invoice.id),
    }));
}

/** RF-142: avisos Pendientes con su email y adjuntos, del más antiguo al más reciente. */
export function listNotices(db: Db): NoticeDto[] {
  const rows = db
    .select({ id: notices.id, emailId: notices.receivedEmailId })
    .from(notices)
    .innerJoin(receivedEmails, eq(notices.receivedEmailId, receivedEmails.id))
    .where(eq(notices.status, 'pendiente'))
    .orderBy(asc(receivedEmails.receivedAt), asc(notices.id))
    .all();
  return rows.flatMap((row) => emailsByIds(db, [row.emailId]).map((email) => ({ id: row.id, email })));
}

/** RF-148: un Admin o Editor marca un aviso como Revisado y queda registrado quién lo hizo. */
export function markNoticeReviewed(db: Db, noticeId: number, userId: number, now: Date): void {
  const result = db
    .update(notices)
    .set({ status: 'revisado', reviewedByUserId: userId, reviewedAt: now.toISOString() })
    .where(eq(notices.id, noticeId))
    .run();
  if (result.changes === 0) throw new NoticeNotFoundError('El aviso no existe.');
}

/**
 * Cambio de estado que hace un usuario (RF-143 a RF-147): solo hacia Pagada o Pendiente de pago, desde
 * los estados que permite `invoice-status.ts`. Con control optimista (research R-14): si la factura ya no
 * está en `expectedStatus` lanza StatusConflictError con el estado vigente y no cambia nada (RF-218). Al
 * salir de Revisión manual la factura deja de tener motivo (RF-140); el cambio queda registrado con el
 * usuario y en el historial del cliente.
 */
export function changeInvoiceStatus(
  db: Db,
  input: {
    invoiceId: number;
    to: 'pagada' | 'pendiente_de_pago';
    expectedStatus: InvoiceStatus;
    userId: number;
    now: Date;
  },
): ReviewInvoiceDto {
  return db.transaction((tx) => {
    const current = tx
      .select({ invoice: invoices, clientName: clients.businessName })
      .from(invoices)
      .innerJoin(clients, eq(invoices.clientId, clients.id))
      .where(eq(invoices.id, input.invoiceId))
      .get();
    if (!current) throw new InvoiceNotFoundError('La factura no existe.');
    if (current.invoice.status !== input.expectedStatus) throw new StatusConflictError(current.invoice.status);
    if (!canTransition(input.expectedStatus, input.to, 'usuario')) {
      throw new UserTransitionError(`No se puede pasar una factura de ${input.expectedStatus} a ${input.to}.`);
    }

    const at = input.now.toISOString();
    const updated = tx
      .update(invoices)
      .set({ status: input.to, manualReviewReason: null, updatedAt: at })
      .where(and(eq(invoices.id, input.invoiceId), eq(invoices.status, input.expectedStatus)))
      .returning()
      .get();
    if (!updated) throw new StatusConflictError(current.invoice.status);

    tx.insert(invoiceStatusChanges)
      .values({
        invoiceId: input.invoiceId,
        fromStatus: input.expectedStatus,
        toStatus: input.to,
        previousReason: current.invoice.manualReviewReason,
        reason: null,
        actorType: 'usuario',
        userId: input.userId,
        changedAt: at,
      })
      .run();
    recordClientEvent(tx, {
      clientId: updated.clientId,
      type: 'estado_factura',
      payload: { invoiceId: updated.id, from: input.expectedStatus, to: input.to },
      actor: { type: 'usuario', userId: input.userId },
      at: input.now,
    });
    return toInvoiceDto(updated, current.clientName);
  });
}

/**
 * RF-216: decisiones de usuarios sobre facturas que estaban en Pago recibido o Revisión manual, de la más
 * reciente a la más antigua, filtrables por cliente y por rango de fechas de la decisión (días de
 * Argentina, `YYYY-MM-DD`, incluidos los dos extremos).
 */
export function listResolved(db: Db, filters: { clientId?: number; from?: string; to?: string }): ResolvedPaymentDto[] {
  const conditions: SQL[] = [
    eq(invoiceStatusChanges.actorType, 'usuario'),
    inArray(invoiceStatusChanges.fromStatus, REVIEW_STATUSES),
    inArray(invoiceStatusChanges.toStatus, ['pagada', 'pendiente_de_pago']),
  ];
  if (filters.clientId !== undefined) conditions.push(eq(invoices.clientId, filters.clientId));
  if (filters.from) {
    conditions.push(gte(invoiceStatusChanges.changedAt, startOfArgentinaDay(filters.from).toISOString()));
  }
  if (filters.to) {
    conditions.push(lt(invoiceStatusChanges.changedAt, startOfArgentinaDay(addDays(filters.to, 1)).toISOString()));
  }

  return db
    .select({ change: invoiceStatusChanges, invoice: invoices, clientName: clients.businessName, user: users })
    .from(invoiceStatusChanges)
    .innerJoin(invoices, eq(invoiceStatusChanges.invoiceId, invoices.id))
    .innerJoin(clients, eq(invoices.clientId, clients.id))
    .innerJoin(users, eq(invoiceStatusChanges.userId, users.id))
    .where(and(...conditions))
    .orderBy(desc(invoiceStatusChanges.changedAt), desc(invoiceStatusChanges.id))
    .all()
    .map(({ change, invoice, clientName, user }) => ({
      invoice: toInvoiceDto(invoice, clientName),
      decision: change.toStatus as ResolvedPaymentDto['decision'],
      decidedBy: { id: user.id, name: user.name },
      decidedAt: change.changedAt,
      previousStatus: change.fromStatus as ResolvedPaymentDto['previousStatus'],
      previousReason: change.previousReason,
      emails: emailsOfInvoice(db, invoice.id),
    }));
}
