import { and, eq, inArray } from 'drizzle-orm';
import type { ClassificationResult, IncomingEmail } from '../adapters/types.ts';
import type { AppContext } from '../context.ts';
import type { Conn } from '../db/client.ts';
import {
  clients,
  invoiceEmails,
  invoices,
  invoiceStatusChanges,
  notices,
  receivedAttachments,
  receivedEmails,
} from '../db/schema.ts';
import { parseExtractedCuit } from '../domain/cuit.ts';
import { type Classification, classifyEmail } from '../domain/email-classification.ts';
import { detectFileType, type VerifiedFileType } from '../domain/file-signature.ts';
import { assertTransition, OWED_STATUSES, reasonAfterTransition } from '../domain/invoice-status.ts';
import { parseExtractedAmount } from '../domain/money.ts';
import { decidePayment, type OwedInvoiceState, type PaymentDecision } from '../domain/payment-rules.ts';
import { normalizeEmail } from './auth.ts';
import { recordClientEvent } from './history.ts';

/** Adjunto que pasó la verificación por firma, con su tipo real (RF-117). */
interface VerifiedAttachment {
  filename: string;
  mimeType: VerifiedFileType;
  content: Uint8Array;
}

interface ClassifiedAttachment extends VerifiedAttachment {
  result: ClassificationResult;
}

const AGENT = { type: 'agente' } as const;

/**
 * RF-115 a RF-117: solo cuentan como adjuntos los archivos que no están embebidos en el cuerpo y cuyo
 * contenido es un PDF o una imagen JPEG, PNG, GIF o WebP según su firma; el tipo declarado no se usa.
 */
function verifiedAttachments(email: IncomingEmail): VerifiedAttachment[] {
  return email.attachments.flatMap((attachment) => {
    if (attachment.inline) return [];
    const mimeType = detectFileType(attachment.content);
    return mimeType ? [{ filename: attachment.filename, mimeType, content: attachment.content }] : [];
  });
}

/** Datos del historial de cada adjunto (RF-124): su clasificación, el CUIT y el monto o la marca de error. */
function attachmentSummary({ filename, result }: ClassifiedAttachment) {
  switch (result.kind) {
    case 'si':
      return { filename, classification: 'si', cuit: parseExtractedCuit(result.cuit), amountRaw: result.amountRaw };
    case 'error':
      return { filename, classification: 'error', error: result.message };
    default:
      return { filename, classification: result.kind };
  }
}

/**
 * Aplica la decisión de las reglas (RF-126 a RF-139): cambia el estado de las facturas con su motivo,
 * registra cada cambio y su evento en el historial y asocia el email a cada factura que cambió.
 */
function applyDecision(conn: Conn, decision: PaymentDecision, ctx: { clientId: number; emailId: number; at: Date }) {
  if (decision.action === 'ninguna') return;
  const to = decision.action;
  const reason = decision.action === 'revision_manual' ? decision.reason : null;
  const at = ctx.at.toISOString();

  for (const invoiceId of decision.invoiceIds) {
    const invoice = conn.select().from(invoices).where(eq(invoices.id, invoiceId)).get();
    if (!invoice) continue;
    assertTransition(invoice.status, to, 'agente'); // el agente nunca pasa una factura a Pagada
    conn.update(invoices)
      .set({ status: to, manualReviewReason: reasonAfterTransition(to, reason), updatedAt: at })
      .where(eq(invoices.id, invoiceId))
      .run();
    conn.insert(invoiceStatusChanges)
      .values({
        invoiceId,
        fromStatus: invoice.status,
        toStatus: to,
        previousReason: invoice.manualReviewReason,
        reason,
        actorType: 'agente',
        receivedEmailId: ctx.emailId,
        changedAt: at,
      })
      .run();
    conn.insert(invoiceEmails).values({ invoiceId, receivedEmailId: ctx.emailId }).onConflictDoNothing().run();
    recordClientEvent(conn, {
      clientId: ctx.clientId,
      type: 'estado_factura',
      payload: { invoiceId, from: invoice.status, to, reason, rule: decision.rule },
      actor: AGENT,
      at: ctx.at,
    });
  }
}

/** Procesa un email ya leído de la casilla. Devuelve false si no correspondía procesarlo. */
async function processEmail(ctx: AppContext, email: IncomingEmail): Promise<boolean> {
  const { db, adapters } = ctx;
  // RF-109: cada Message-ID se procesa una sola vez.
  const seen = db
    .select({ id: receivedEmails.id })
    .from(receivedEmails)
    .where(eq(receivedEmails.messageId, email.messageId))
    .get();
  if (seen) return false;
  // RF-110: los emails que envía la propia casilla no se procesan.
  const from = normalizeEmail(email.from);
  if (from === normalizeEmail(adapters.mailbox.address)) return false;

  // RF-111, RF-112: el remitente tiene que ser el email de facturación de un cliente, sin mayúsculas.
  const client = db.select().from(clients).where(eq(clients.billingEmailNormalized, from)).get();
  const attachments = verifiedAttachments(email);

  // Los adjuntos de un mismo email se clasifican en paralelo (RNF-01); los de un aviso no van al LLM.
  const classified: ClassifiedAttachment[] = client
    ? await Promise.all(
        attachments.map(async (attachment) => ({
          ...attachment,
          result: await adapters.classifier.classify({ emailBody: email.bodyText, ...attachment }),
        })),
      )
    : [];
  const classification: Classification | null = client ? classifyEmail(classified.map((a) => a.result.kind)) : null;
  const now = adapters.clock.now();

  db.transaction((tx) => {
    const received = tx
      .insert(receivedEmails)
      .values({
        messageId: email.messageId,
        fromAddress: email.from,
        fromNormalized: from,
        subject: email.subject,
        bodyText: email.bodyText,
        receivedAt: email.receivedAt.toISOString(),
        clientId: client?.id ?? null,
        classification,
        processedAt: now.toISOString(),
      })
      .returning()
      .get();

    const saved = client ? classified : attachments.map((attachment) => ({ ...attachment, result: null }));
    for (const attachment of saved) {
      const result = attachment.result;
      const amount = result?.kind === 'si' ? parseExtractedAmount(result.amountRaw) : null;
      tx.insert(receivedAttachments)
        .values({
          receivedEmailId: received.id,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          content: Buffer.from(attachment.content),
          classification: result?.kind ?? null,
          // RF-122, RF-125: solo los dígitos, y null si no tiene 11.
          extractedCuit: result?.kind === 'si' ? parseExtractedCuit(result.cuit) : null,
          extractedAmountCents: amount?.status === 'ok' ? amount.cents : null,
          extractedAmountRaw: result?.kind === 'si' ? result.amountRaw : null,
          errorMessage: result?.kind === 'error' ? result.message : null,
        })
        .run();
    }

    // RF-113: un remitente que no es ningún cliente queda como aviso Pendiente, sin validar el pago.
    if (!client) {
      tx.insert(notices).values({ receivedEmailId: received.id, status: 'pendiente' }).run();
      return;
    }

    // RF-114, RF-124: el email y el resultado de cada adjunto quedan en el historial del cliente.
    recordClientEvent(tx, {
      clientId: client.id,
      type: 'email_recibido',
      payload: {
        receivedEmailId: received.id,
        subject: email.subject,
        receivedAt: email.receivedAt.toISOString(),
        classification,
        attachments: classified.map(attachmentSummary),
      },
      actor: AGENT,
      at: now,
    });

    // RF-115: un email sin adjuntos no dispara ninguna otra acción.
    if (classification === null) return;

    // RF-118: los emails de un cliente Inactivo se procesan igual.
    const owed: OwedInvoiceState[] = tx
      .select({ id: invoices.id, period: invoices.period, totalCents: invoices.totalCents, status: invoices.status })
      .from(invoices)
      .where(and(eq(invoices.clientId, client.id), inArray(invoices.status, [...OWED_STATUSES])))
      .all() as OwedInvoiceState[];
    const decision = decidePayment({
      classification,
      clientCuit: client.cuit,
      owedInvoices: owed,
      receipts: classified.flatMap(({ result }) =>
        result.kind === 'si' ? [{ cuit: result.cuit, amountRaw: result.amountRaw }] : [],
      ),
    });
    applyDecision(tx, decision, { clientId: client.id, emailId: received.id, at: now });
    tx.update(receivedEmails).set({ appliedRule: decision.rule }).where(eq(receivedEmails.id, received.id)).run();
  });
  return true;
}

/**
 * Procesa los emails leídos en una revisión de la casilla (RF-108 a RF-140), del más antiguo al más
 * reciente según su fecha de recepción. Cada email se guarda, con su efecto sobre las facturas, en una
 * sola transacción. Devuelve cuántos se procesaron.
 */
export async function processEmails(ctx: AppContext, emails: IncomingEmail[]): Promise<number> {
  const ordered = [...emails].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  let processed = 0;
  for (const email of ordered) {
    if (await processEmail(ctx, email)) processed += 1;
  }
  return processed;
}
