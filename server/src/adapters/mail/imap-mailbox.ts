import type { Readable } from 'node:stream';
import { ImapFlow } from 'imapflow';
import { type IncomingEmail, type Mailbox, TimeoutError } from '../types.ts';

/** RNF-07: el servidor de email se da por caído si no responde en 30 s. */
export const IMAP_TIMEOUT_MS = 30_000;

/** Parte de un mensaje según su estructura MIME (la que devuelve imapflow con `bodyStructure`). */
interface MimeNode {
  part?: string;
  type: string;
  id?: string;
  disposition?: string;
  dispositionParameters?: Record<string, string>;
  parameters?: Record<string, string>;
  childNodes?: MimeNode[];
}

interface FetchedMessage {
  uid: number;
  internalDate?: Date | string;
  envelope?: { messageId?: string; subject?: string; from?: Array<{ address?: string }> };
  bodyStructure?: MimeNode;
}

/** Lo que este adapter usa del cliente de imapflow; los tests pasan uno simulado. */
export interface ImapClient {
  connect(): Promise<void>;
  getMailboxLock(path: string): Promise<{ release(): void }>;
  search(query: { since: Date }, options: { uid: true }): Promise<number[] | false | undefined>;
  fetch(range: number[], query: object, options: { uid: true }): AsyncIterable<FetchedMessage>;
  download(uid: string, part: string, options: { uid: true }): Promise<{ content?: Readable }>;
  logout(): Promise<void>;
  close(): void;
}

export interface ImapOptions {
  user: string;
  appPassword: string;
}

function gmailClient({ user, appPassword }: ImapOptions): ImapClient {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user, pass: appPassword },
    logger: false,
    connectionTimeout: IMAP_TIMEOUT_MS,
    greetingTimeout: IMAP_TIMEOUT_MS,
    socketTimeout: IMAP_TIMEOUT_MS,
  });
  return client as unknown as ImapClient;
}

/** Corta una operación con el servidor a los 30 s (RNF-07). */
function withTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new TimeoutError('El servidor de email no respondió en 30 s.')),
      IMAP_TIMEOUT_MS,
    );
  });
  return Promise.race([operation, expired]).finally(() => clearTimeout(timer));
}

async function readAll(stream: Readable | undefined): Promise<Uint8Array> {
  if (!stream) return new Uint8Array(0);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return new Uint8Array(Buffer.concat(chunks));
}

/** Hojas de la estructura MIME (las partes con contenido). */
function leaves(node: MimeNode | undefined): MimeNode[] {
  if (!node) return [];
  return node.childNodes?.length ? node.childNodes.flatMap(leaves) : [node];
}

const filenameOf = (node: MimeNode) => node.dispositionParameters?.filename ?? node.parameters?.name;

/**
 * Casilla del sistema en Gmail por IMAP con contraseña de aplicación (research R-08). Solo lee INBOX. Las
 * partes `inline` con Content-ID son imágenes embebidas en el cuerpo y no cuentan como adjuntos (RF-116);
 * los adjuntos se devuelven con su tipo declarado y el procesamiento verifica el formato por su firma
 * (RF-117). Un cliente nuevo por revisión: si la casilla falla, la siguiente vuelve a conectarse (RF-104).
 */
export function createImapMailbox(
  options: ImapOptions,
  createClient: () => ImapClient = () => gmailClient(options),
): Mailbox {
  return {
    address: options.user,

    async fetchSince(since) {
      const client = createClient();
      try {
        await withTimeout(client.connect());
        const lock = await withTimeout(client.getMailboxLock('INBOX'));
        let emails: IncomingEmail[];
        try {
          emails = await readSince(client, since);
        } finally {
          lock.release();
        }
        await withTimeout(client.logout()).catch(() => client.close());
        return emails;
      } catch (error) {
        client.close();
        throw error;
      }
    },
  };
}

async function readSince(client: ImapClient, since: Date): Promise<IncomingEmail[]> {
  // IMAP busca por día: el filtro fino por hora se hace con la fecha de llegada de cada mensaje.
  const uids = await withTimeout(client.search({ since }, { uid: true }));
  if (!uids || uids.length === 0) return [];

  // imapflow no permite descargar partes mientras recorre un fetch: primero se juntan los mensajes.
  const messages: FetchedMessage[] = [];
  const query = { uid: true, envelope: true, internalDate: true, bodyStructure: true };
  for await (const message of client.fetch(uids, query, { uid: true })) {
    const receivedAt = message.internalDate ? new Date(message.internalDate) : null;
    if (receivedAt && receivedAt.getTime() >= since.getTime()) messages.push(message);
  }

  const emails: IncomingEmail[] = [];
  for (const message of messages) {
    const download = async (part: string) =>
      readAll((await withTimeout(client.download(String(message.uid), part, { uid: true }))).content);
    const parts = leaves(message.bodyStructure);
    const body = parts.find(
      (node) => node.type === 'text/plain' && node.disposition !== 'attachment' && !filenameOf(node),
    );
    const attachments: IncomingEmail['attachments'] = [];
    for (const node of parts) {
      if (node === body || !node.part) continue;
      const embedded = node.disposition === 'inline' && Boolean(node.id);
      const isAttachment = node.disposition === 'attachment' || (Boolean(filenameOf(node)) && !embedded);
      // Las imágenes embebidas no se descargan: no cuentan como adjuntos (RF-116).
      if (embedded) {
        const filename = filenameOf(node) ?? 'embebida';
        attachments.push({ filename, mimeType: node.type, content: new Uint8Array(0), inline: true });
      } else if (isAttachment) {
        const filename = filenameOf(node) ?? 'adjunto';
        attachments.push({ filename, mimeType: node.type, content: await download(node.part), inline: false });
      }
    }
    const sender = message.envelope?.from?.[0]?.address ?? '';
    const receivedAt = new Date(message.internalDate as Date | string);
    emails.push({
      // Sin Message-ID (raro) se arma uno estable con la fecha y el remitente, para no procesarlo dos veces.
      messageId: message.envelope?.messageId ?? `<sin-id-${receivedAt.getTime()}-${sender}>`,
      from: sender,
      subject: message.envelope?.subject ?? '',
      bodyText: body ? new TextDecoder().decode(await download(body.part ?? '1')) : '',
      receivedAt,
      attachments,
    });
  }
  return emails;
}
