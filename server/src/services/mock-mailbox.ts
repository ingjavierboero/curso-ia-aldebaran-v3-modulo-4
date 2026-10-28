import { and, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { createMockMail } from '../adapters/mail/mock-mailbox.ts';
import type { Clock } from '../adapters/types.ts';
import type { Db } from '../db/client.ts';
import { clients, simulatedAttachments, simulatedEmails } from '../db/schema.ts';
import { detectFileType } from '../domain/file-signature.ts';
import type { MockEmailDto, Role } from '../http/types.ts';

/** El email no existe o el perfil no lo puede ver (RF-198): para quien no lo ve, no existe. */
export class MockEmailNotFoundError extends Error {}

/** Email recibido que carga un Admin o Editor, con el contenido de cada adjunto (RF-200). */
export interface LoadReceivedInput {
  from: string;
  subject: string;
  body: string;
  attachments: Array<{ filename: string; content: Uint8Array }>;
  userId: number;
}

/**
 * Emails que ve cada perfil (RF-197, RF-198): un Admin, todos; un Editor o Consulta, solo los recibidos
 * desde el email de facturación de un cliente, sin distinguir mayúsculas.
 */
function visibleTo(role: Role): SQL | undefined {
  if (role === 'admin') return undefined;
  return and(
    eq(simulatedEmails.direction, 'recibido'),
    inArray(
      sql`lower(trim(${simulatedEmails.fromAddress}))`,
      sql`(select ${clients.billingEmailNormalized} from ${clients})`,
    ),
  );
}

function toDtos(db: Db, emails: Array<typeof simulatedEmails.$inferSelect>): MockEmailDto[] {
  const attachments = emails.length
    ? db
        .select({
          id: simulatedAttachments.id,
          emailId: simulatedAttachments.simulatedEmailId,
          filename: simulatedAttachments.filename,
          mimeType: simulatedAttachments.mimeType,
        })
        .from(simulatedAttachments)
        .where(
          inArray(
            simulatedAttachments.simulatedEmailId,
            emails.map((email) => email.id),
          ),
        )
        .orderBy(simulatedAttachments.id)
        .all()
    : [];
  return emails.map((email) => ({
    id: email.id,
    direction: email.direction,
    messageId: email.messageId,
    from: email.fromAddress,
    fromName: email.fromName,
    to: email.toAddress,
    subject: email.subject,
    body: email.body,
    createdAt: email.createdAt,
    attachments: attachments
      .filter((attachment) => attachment.emailId === email.id)
      .map(({ id, filename, mimeType }) => ({ id, filename, mimeType })),
  }));
}

/** Casilla simulada según el perfil, de la más reciente a la más antigua. */
export function listMockEmails(db: Db, role: Role): MockEmailDto[] {
  const emails = db
    .select()
    .from(simulatedEmails)
    .where(visibleTo(role))
    .orderBy(desc(simulatedEmails.createdAt), desc(simulatedEmails.id))
    .all();
  return toDtos(db, emails);
}

/**
 * Carga un email recibido en la casilla simulada (RF-200 a RF-202). El tipo de cada adjunto se toma de
 * su firma, no del que declara quien lo carga: lo que no es un PDF ni una imagen queda como
 * `application/octet-stream` y solo se puede descargar (RNF-16, AC-255).
 */
export function loadReceivedEmail(db: Db, clock: Clock, input: LoadReceivedInput): MockEmailDto {
  const saved = createMockMail(db, clock).addReceived({
    from: input.from,
    subject: input.subject,
    body: input.body,
    loadedByUserId: input.userId,
    attachments: input.attachments.map((attachment) => ({
      filename: attachment.filename,
      mimeType: detectFileType(attachment.content) ?? 'application/octet-stream',
      content: attachment.content,
    })),
  });
  return toDtos(db, [saved])[0]!;
}

/** Adjunto de un email que el perfil puede ver; si no, MockEmailNotFoundError. */
export function findMockAttachment(db: Db, role: Role, emailId: number, attachmentId: number) {
  const email = db
    .select({ id: simulatedEmails.id })
    .from(simulatedEmails)
    .where(and(eq(simulatedEmails.id, emailId), visibleTo(role)))
    .get();
  const attachment = email
    ? db
        .select()
        .from(simulatedAttachments)
        .where(and(eq(simulatedAttachments.id, attachmentId), eq(simulatedAttachments.simulatedEmailId, emailId)))
        .get()
    : undefined;
  if (!attachment) throw new MockEmailNotFoundError('El adjunto no existe.');
  return attachment;
}
