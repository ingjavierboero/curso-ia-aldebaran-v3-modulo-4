import { and, asc, eq, inArray } from 'drizzle-orm';
import type { AppContext } from '../context.ts';
import type { Db } from '../db/client.ts';
import { clients, invoices, sentEmails } from '../db/schema.ts';
import { OWED_STATUSES } from '../domain/invoice-status.ts';
import { reminderEmail } from '../documents/email-templates.ts';
import { formatVoucherNumber } from '../documents/format.ts';
import { ClientNotFoundError } from './clients.ts';
import { recordClientEvent } from './history.ts';
import { getSettings } from './settings.ts';

type Client = typeof clients.$inferSelect;

/** Motivo por el que un cliente no puede recibir el recordatorio, con el mensaje para el usuario. */
export class ReminderBlockedError extends Error {
  readonly code: 'cliente_inactivo' | 'sin_deuda' | 'en_revision';

  constructor(code: ReminderBlockedError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

/** El email no se pudo enviar: el recordatorio no queda registrado. */
export class ReminderSendError extends Error {}

/** Facturas adeudadas del cliente, de la más antigua a la más reciente (PRD, Definiciones). */
function owedInvoices(db: Db, clientId: number) {
  return db
    .select()
    .from(invoices)
    .where(and(eq(invoices.clientId, clientId), inArray(invoices.status, [...OWED_STATUSES])))
    .orderBy(asc(invoices.period), asc(invoices.id))
    .all();
}

/**
 * Por qué el cliente no puede recibir el recordatorio, o null si puede: tiene que estar Activo (RF-96),
 * tener deuda vigente (RF-155, RF-156) y no estar en revisión (RF-149, RF-157).
 */
export function reminderBlock(db: Db, client: Client): ReminderBlockedError | null {
  if (client.status !== 'activo') {
    return new ReminderBlockedError('cliente_inactivo', 'El cliente está Inactivo: no se le envían recordatorios.');
  }
  const owed = owedInvoices(db, client.id);
  if (owed.length === 0) {
    return new ReminderBlockedError('sin_deuda', 'El cliente no tiene deuda pendiente.');
  }
  if (owed.some((invoice) => invoice.status === 'revision_manual')) {
    return new ReminderBlockedError(
      'en_revision',
      'El cliente tiene un pago en revisión manual: resolvelo antes de enviarle un recordatorio.',
    );
  }
  return null;
}

/** Clientes que reciben el recordatorio de fin de mes (RF-149): Activos, con deuda vigente y sin revisión. */
export function clientsToRemind(db: Db): Client[] {
  return db
    .select()
    .from(clients)
    .where(eq(clients.status, 'activo'))
    .orderBy(asc(clients.id))
    .all()
    .filter((client) => reminderBlock(db, client) === null);
}

export interface SendReminderInput {
  clientId: number;
  trigger: 'automatico' | 'manual' | 'reintento_manual';
  /** Usuario que lo envía desde el dashboard; sin usuario, lo envía el agente. */
  userId?: number;
  /** Mes de la corrida de fin de mes (`YYYY-MM`), para retomarla si se interrumpe (RF-149). */
  reminderMonth?: string;
}

/**
 * Envía el recordatorio de deuda a un cliente con sus facturas adeudadas actuales (RF-149 a RF-151,
 * RF-154). Si el cliente no puede recibirlo lanza ReminderBlockedError sin enviar nada; si el envío
 * falla, ReminderSendError. Solo un envío exitoso queda en `sent_emails` y en el historial del cliente,
 * como acción del usuario o del agente (AC-12, AC-13, AC-154).
 */
export async function sendReminder(ctx: AppContext, input: SendReminderInput): Promise<{ sentAt: string }> {
  const { db, adapters, env } = ctx;
  const client = db.select().from(clients).where(eq(clients.id, input.clientId)).get();
  if (!client) throw new ClientNotFoundError('El cliente no existe.');
  const block = reminderBlock(db, client);
  if (block) throw block;

  const settings = getSettings(db);
  const email = reminderEmail({
    mode: env.mode,
    to: client.billingEmail,
    clientName: client.businessName,
    senderName: settings.issuerTradeName || settings.issuerBusinessName || client.businessName,
    invoices: owedInvoices(db, client.id).map((invoice) => ({
      voucherNumber: formatVoucherNumber(invoice.pointOfSale, invoice.number ?? 0),
      period: invoice.period,
      totalCents: invoice.totalCents,
      dueDate: invoice.dueDate,
    })),
  });

  try {
    await adapters.mailSender.send(email);
  } catch (error) {
    throw new ReminderSendError(
      `No se pudo enviar el recordatorio: ${error instanceof Error ? error.message : 'error desconocido'}`,
    );
  }

  const sentAt = adapters.clock.now();
  db.transaction((tx) => {
    tx.insert(sentEmails)
      .values({
        kind: 'recordatorio',
        trigger: input.trigger,
        clientId: client.id,
        reminderMonth: input.reminderMonth ?? null,
        toAddress: email.to,
        subject: email.subject,
        body: email.text,
        sentAt: sentAt.toISOString(),
        sentByUserId: input.userId ?? null,
      })
      .run();
    recordClientEvent(tx, {
      clientId: client.id,
      type: 'email_enviado',
      payload: { kind: 'recordatorio', trigger: input.trigger, to: email.to, subject: email.subject },
      actor: input.userId ? { type: 'usuario', userId: input.userId } : { type: 'agente' },
      at: sentAt,
    });
  });
  return { sentAt: sentAt.toISOString() };
}
