import { randomUUID } from 'node:crypto';
import { and, asc, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { simulatedAttachments, simulatedEmails } from '../../db/schema.ts';
import type { Clock, EmailAttachment, Mailbox, MailSender } from '../types.ts';

/** Dirección de la casilla del sistema en modo mock (RF-195). */
export const MOCK_MAILBOX_ADDRESS = 'aldebaran-mock@gmail.com';

/** Email recibido que un usuario carga en la casilla simulada (RF-200). */
export interface ReceivedEmailInput {
  from: string;
  subject: string;
  body: string;
  attachments: EmailAttachment[];
  loadedByUserId?: number;
}

const newMessageId = () => `<${randomUUID()}@aldebaran-mock>`;

/**
 * Casilla simulada del modo mock (RF-194 a RF-203): reemplaza a Gmail. Guarda lo que el sistema
 * envía y los emails recibidos que carga un usuario, y entrega los recibidos a la revisión de la
 * casilla como si vinieran por IMAP.
 */
export function createMockMail(db: Db, clock: Clock) {
  function save(email: typeof simulatedEmails.$inferInsert, attachments: EmailAttachment[]) {
    return db.transaction((tx) => {
      const saved = tx.insert(simulatedEmails).values(email).returning().get();
      for (const attachment of attachments) {
        tx.insert(simulatedAttachments)
          .values({
            simulatedEmailId: saved.id,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            content: Buffer.from(attachment.content),
          })
          .run();
      }
      return saved;
    });
  }

  /** RF-196: cada email que envía el sistema queda en la casilla simulada. */
  const sender: MailSender = {
    async send(msg) {
      const messageId = newMessageId();
      save(
        {
          direction: 'enviado',
          messageId,
          fromAddress: MOCK_MAILBOX_ADDRESS,
          fromName: msg.fromName,
          toAddress: msg.to,
          subject: msg.subject,
          body: msg.text,
          createdAt: clock.now().toISOString(),
        },
        msg.attachments ?? [],
      );
      return { messageId };
    },
  };

  /** RF-203: la revisión de la casilla lee los recibidos desde la fecha indicada, en orden de recepción. */
  const mailbox: Mailbox = {
    address: MOCK_MAILBOX_ADDRESS,
    async fetchSince(since) {
      const emails = db
        .select()
        .from(simulatedEmails)
        .where(and(eq(simulatedEmails.direction, 'recibido'), gte(simulatedEmails.createdAt, since.toISOString())))
        .orderBy(asc(simulatedEmails.createdAt), asc(simulatedEmails.id))
        .all();
      if (emails.length === 0) return [];

      const attachments = db
        .select()
        .from(simulatedAttachments)
        .where(
          inArray(
            simulatedAttachments.simulatedEmailId,
            emails.map((email) => email.id),
          ),
        )
        .all();

      return emails.map((email) => ({
        messageId: email.messageId,
        from: email.fromAddress,
        subject: email.subject,
        bodyText: email.body,
        receivedAt: new Date(email.createdAt),
        attachments: attachments
          .filter((attachment) => attachment.simulatedEmailId === email.id)
          .map((attachment) => ({
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            content: new Uint8Array(attachment.content),
            inline: false,
          })),
      }));
    },
  };

  /** RF-200 a RF-202: carga un email recibido con Message-ID único y la fecha de carga como recepción. */
  function addReceived(input: ReceivedEmailInput) {
    return save(
      {
        direction: 'recibido',
        messageId: newMessageId(),
        fromAddress: input.from.trim(),
        toAddress: MOCK_MAILBOX_ADDRESS,
        subject: input.subject,
        body: input.body,
        createdAt: clock.now().toISOString(),
        loadedByUserId: input.loadedByUserId,
      },
      input.attachments,
    );
  }

  return { sender, mailbox, addReceived };
}
