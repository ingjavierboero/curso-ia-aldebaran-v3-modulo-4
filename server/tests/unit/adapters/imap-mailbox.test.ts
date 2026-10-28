import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimeoutError } from '../../../src/adapters/types.ts';

// imapflow se reemplaza: ningún test se conecta a Gmail (AGENTS.md).
const imap = vi.hoisted(() => ({ constructed: [] as unknown[] }));
vi.mock('imapflow', () => ({
  ImapFlow: class {
    constructor(options: unknown) {
      imap.constructed.push(options);
    }
  },
}));

const { createImapMailbox } = await import('../../../src/adapters/mail/imap-mailbox.ts');

// ------------------------------------------------------------------ Casilla simulada

interface FakeMessage {
  uid: number;
  internalDate: Date;
  envelope: { messageId: string; subject: string; from: Array<{ address: string; name?: string }> };
  bodyStructure: { type: string } & Record<string, unknown>;
  /** Contenido de cada parte, por número de parte. */
  parts: Record<string, string | Uint8Array>;
}

/** Cliente de imapflow simulado sobre una lista de mensajes; registra las llamadas. */
function fakeClient(messages: FakeMessage[], overrides: Partial<Record<'connect', () => Promise<void>>> = {}) {
  const calls: string[] = [];
  let searchQuery: unknown;
  const client = {
    connect: overrides.connect ?? (async () => void calls.push('connect')),
    async getMailboxLock(path: string) {
      calls.push(`lock:${path}`);
      return { release: () => calls.push('release') };
    },
    async search(query: { since: Date }, _options: unknown) {
      searchQuery = query;
      return messages.map((m) => m.uid);
    },
    async *fetch(_range: unknown, _query: unknown, _options: unknown) {
      for (const message of messages) yield message;
    },
    async download(uid: string, part: string, _options: unknown) {
      calls.push(`download:${uid}:${part}`);
      const message = messages.find((m) => String(m.uid) === uid);
      const data = message?.parts[part] ?? '';
      return { meta: {}, content: Readable.from([typeof data === 'string' ? Buffer.from(data) : Buffer.from(data)]) };
    },
    async logout() {
      calls.push('logout');
    },
    close() {
      calls.push('close');
    },
  };
  return { client, calls, searchQuery: () => searchQuery };
}

const PDF = new TextEncoder().encode('%PDF-1.7 comprobante');
const DOCX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]);

/** Email con cuerpo de texto, un PDF adjunto, un .docx adjunto y un logo embebido en la firma. */
const MESSAGE: FakeMessage = {
  uid: 41,
  internalDate: new Date('2026-10-20T15:00:00.000Z'),
  envelope: {
    messageId: '<abc123@gmail.com>',
    subject: 'Pago factura octubre',
    from: [{ address: 'Pagos@LosAndes.com', name: 'Los Andes' }],
  },
  bodyStructure: {
    type: 'multipart/mixed',
    childNodes: [
      {
        type: 'multipart/related',
        part: '1',
        childNodes: [
          { part: '1.1', type: 'text/plain', parameters: { charset: 'utf-8' } },
          { part: '1.2', type: 'image/png', disposition: 'inline', id: '<logo@firma>', dispositionParameters: { filename: 'logo.png' } },
        ],
      },
      { part: '2', type: 'application/pdf', disposition: 'attachment', dispositionParameters: { filename: 'comprobante.pdf' } },
      {
        part: '3',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        disposition: 'attachment',
        dispositionParameters: { filename: 'nota.docx' },
      },
    ],
  },
  parts: { '1.1': 'Adjunto el comprobante.', '2': PDF, '3': DOCX },
};

afterEach(() => vi.useRealTimers());

describe('lectura de la casilla por IMAP (research R-08)', () => {
  it('AC-227: se conecta a Gmail por IMAP con GMAIL_USER, la contraseña de aplicación y timeouts de 30 s', async () => {
    imap.constructed.length = 0;
    const mailbox = createImapMailbox({ user: 'sistema@empresa.com', appPassword: 'clave-de-app' });
    expect(mailbox.address).toBe('sistema@empresa.com');
    // El cliente real se crea en cada revisión; acá solo se verifica su configuración.
    await mailbox.fetchSince(new Date()).catch(() => undefined);
    expect(imap.constructed[0]).toMatchObject({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: { user: 'sistema@empresa.com', pass: 'clave-de-app' },
      connectionTimeout: 30_000,
      greetingTimeout: 30_000,
      socketTimeout: 30_000,
    });
  });

  it('RF-107, RF-108: busca en INBOX los emails desde la fecha de corte y devuelve cada uno con su Message-ID, remitente, asunto, cuerpo y fecha', async () => {
    const fake = fakeClient([MESSAGE]);
    const since = new Date('2026-10-20T00:00:00.000Z');
    const [email] = await createImapMailbox({ user: 'u', appPassword: 'p' }, () => fake.client).fetchSince(since);

    expect(fake.calls).toContain('lock:INBOX');
    expect(fake.searchQuery()).toEqual({ since });
    expect(email).toMatchObject({
      messageId: '<abc123@gmail.com>',
      from: 'Pagos@LosAndes.com',
      subject: 'Pago factura octubre',
      bodyText: 'Adjunto el comprobante.',
      receivedAt: new Date('2026-10-20T15:00:00.000Z'),
    });
  });

  it('IMAP busca por día: los emails recibidos antes de la fecha de corte ese mismo día no se devuelven', async () => {
    const early = { ...MESSAGE, uid: 40, internalDate: new Date('2026-10-20T09:00:00.000Z') };
    const fake = fakeClient([early, MESSAGE]);
    const emails = await createImapMailbox({ user: 'u', appPassword: 'p' }, () => fake.client).fetchSince(
      new Date('2026-10-20T12:00:00.000Z'),
    );
    expect(emails.map((e) => e.messageId)).toEqual(['<abc123@gmail.com>']);
    expect(fake.calls).not.toContain('download:40:2');
  });

  it('AC-106, RF-116: una imagen embebida en el cuerpo queda marcada como embebida y no se descarga', async () => {
    const fake = fakeClient([MESSAGE]);
    const [email] = await createImapMailbox({ user: 'u', appPassword: 'p' }, () => fake.client).fetchSince(new Date(0));
    expect(email?.attachments).toContainEqual(expect.objectContaining({ filename: 'logo.png', inline: true }));
    expect(fake.calls).not.toContain('download:41:1.2');
  });

  it('RF-117: devuelve cada adjunto con su contenido y su tipo declarado; el formato se verifica después por su firma', async () => {
    const fake = fakeClient([MESSAGE]);
    const [email] = await createImapMailbox({ user: 'u', appPassword: 'p' }, () => fake.client).fetchSince(new Date(0));
    const attachments = email?.attachments.filter((a) => !a.inline) ?? [];

    expect(attachments).toEqual([
      { filename: 'comprobante.pdf', mimeType: 'application/pdf', content: new Uint8Array(PDF), inline: false },
      {
        filename: 'nota.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        content: new Uint8Array(DOCX),
        inline: false,
      },
    ]);
  });

  it('un adjunto inline con nombre de archivo y sin Content-ID (como los de Apple Mail) cuenta como adjunto', async () => {
    const appleMail: FakeMessage = {
      ...MESSAGE,
      bodyStructure: {
        type: 'multipart/mixed',
        childNodes: [
          { part: '1', type: 'text/plain' },
          { part: '2', type: 'application/pdf', disposition: 'inline', dispositionParameters: { filename: 'comprobante.pdf' } },
        ],
      },
      parts: { '1': 'Adjunto el comprobante.', '2': PDF },
    };
    const fake = fakeClient([appleMail]);
    const [email] = await createImapMailbox({ user: 'u', appPassword: 'p' }, () => fake.client).fetchSince(new Date(0));
    expect(email?.attachments).toEqual([
      { filename: 'comprobante.pdf', mimeType: 'application/pdf', content: new Uint8Array(PDF), inline: false },
    ]);
  });

  it('sin emails nuevos devuelve una lista vacía, libera la casilla y cierra la sesión', async () => {
    const fake = fakeClient([]);
    expect(await createImapMailbox({ user: 'u', appPassword: 'p' }, () => fake.client).fetchSince(new Date(0))).toEqual([]);
    expect(fake.calls).toEqual(['connect', 'lock:INBOX', 'release', 'logout']);
  });

  it('un error de conexión hace fallar la revisión y cierra el cliente', async () => {
    const fake = fakeClient([MESSAGE], {
      connect: async () => {
        throw new Error('Invalid credentials');
      },
    });
    await expect(createImapMailbox({ user: 'u', appPassword: 'p' }, () => fake.client).fetchSince(new Date(0))).rejects.toThrow();
    expect(fake.calls.some((call) => call === 'logout' || call === 'close')).toBe(true);
  });

  it('AC-228, RNF-07: si el servidor de email no responde, da la revisión por fallida a los 30 s', async () => {
    vi.useFakeTimers();
    const fake = fakeClient([MESSAGE], { connect: () => new Promise<void>(() => {}) });
    let failure: unknown;
    const pending = createImapMailbox({ user: 'u', appPassword: 'p' }, () => fake.client)
      .fetchSince(new Date(0))
      .catch((error: unknown) => {
        failure = error;
      });

    await vi.advanceTimersByTimeAsync(29_000);
    expect(failure).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(failure).toBeInstanceOf(TimeoutError);
    expect(fake.calls).toContain('close');
  });
});
