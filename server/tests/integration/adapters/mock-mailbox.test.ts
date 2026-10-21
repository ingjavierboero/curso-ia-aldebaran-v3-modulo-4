import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_MAILBOX_ADDRESS, createMockMail } from '../../../src/adapters/mail/mock-mailbox.ts';
import { simulatedAttachments, simulatedEmails } from '../../../src/db/schema.ts';
import { fixedClock } from '../../helpers/fakes.ts';
import { createTestDb } from '../../helpers/test-db.ts';

const pdf = { filename: 'factura.pdf', mimeType: 'application/pdf', content: new Uint8Array([37, 80, 68, 70]) };

describe('casilla simulada (RF-194 a RF-203)', () => {
  const fetchSpy = vi.fn();
  beforeEach(() => vi.stubGlobal('fetch', fetchSpy));
  afterEach(() => vi.unstubAllGlobals());

  it('RF-195: la dirección de la casilla del sistema en modo mock es aldebaran-mock@gmail.com', () => {
    const { mailbox } = createMockMail(createTestDb(), fixedClock('2026-10-15T14:00:00Z'));
    expect(MOCK_MAILBOX_ADDRESS).toBe('aldebaran-mock@gmail.com');
    expect(mailbox.address).toBe('aldebaran-mock@gmail.com');
  });

  it('AC-200, RF-196: cada email enviado se guarda con remitente, destinatario, asunto, cuerpo, adjuntos y fecha de envío', async () => {
    const db = createTestDb();
    const { sender } = createMockMail(db, fixedClock('2026-10-15T14:00:00Z'));

    const { messageId } = await sender.send({
      fromName: 'Estudio Molina',
      to: 'pagos@losandes.com',
      subject: 'Factura C 0003-00000001',
      text: 'Le enviamos la factura del período octubre de 2026.',
      attachments: [pdf],
    });

    const emails = db.select().from(simulatedEmails).all();
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({
      direction: 'enviado',
      messageId,
      fromAddress: 'aldebaran-mock@gmail.com',
      fromName: 'Estudio Molina',
      toAddress: 'pagos@losandes.com',
      subject: 'Factura C 0003-00000001',
      body: 'Le enviamos la factura del período octubre de 2026.',
      createdAt: '2026-10-15T14:00:00.000Z',
    });
    const attachments = db.select().from(simulatedAttachments).all();
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ simulatedEmailId: emails[0]?.id, filename: 'factura.pdf', mimeType: 'application/pdf' });
    expect([...(attachments[0]?.content ?? [])]).toEqual([37, 80, 68, 70]);
  });

  it('AC-203, RF-201, RF-202: un email recibido cargado tiene Message-ID único y la fecha de carga como recepción', () => {
    const db = createTestDb();
    const clock = fixedClock('2026-10-20T13:00:00Z');
    const { addReceived } = createMockMail(db, clock);

    const first = addReceived({ from: 'pagos@losandes.com', subject: 'Pago', body: 'Adjunto el comprobante', attachments: [] });
    clock.advance(60_000);
    const second = addReceived({ from: 'pagos@losandes.com', subject: 'Pago', body: 'Adjunto el comprobante', attachments: [] });

    expect(first.messageId).toBeTruthy();
    expect(first.messageId).not.toBe(second.messageId);
    expect(first.createdAt).toBe('2026-10-20T13:00:00.000Z');
    expect(second.createdAt).toBe('2026-10-20T13:01:00.000Z');
    expect(first).toMatchObject({ direction: 'recibido', toAddress: 'aldebaran-mock@gmail.com' });
  });

  it('AC-203, RF-203: fetchSince entrega solo los recibidos desde la fecha indicada, en orden y con sus adjuntos', async () => {
    const db = createTestDb();
    const clock = fixedClock('2026-10-20T13:00:00Z');
    const { sender, mailbox, addReceived } = createMockMail(db, clock);

    addReceived({ from: 'otro@cliente.com', subject: 'Anterior', body: '', attachments: [] });
    clock.set('2026-10-20T14:00:00Z');
    await sender.send({ fromName: 'Estudio Molina', to: 'pagos@losandes.com', subject: 'Enviado', text: '' });
    addReceived({ from: 'Pagos@LosAndes.com', subject: 'Pago 1', body: 'Cuerpo 1', attachments: [] });
    clock.advance(60_000);
    addReceived({
      from: 'pagos@losandes.com',
      subject: 'Pago 2',
      body: 'Cuerpo 2',
      attachments: [{ filename: 'pago_30711111111_100.pdf', mimeType: 'application/pdf', content: new Uint8Array([9]) }],
    });

    const emails = await mailbox.fetchSince(new Date('2026-10-20T14:00:00Z'));
    expect(emails.map((e) => e.subject)).toEqual(['Pago 1', 'Pago 2']);
    expect(emails[0]).toMatchObject({
      from: 'Pagos@LosAndes.com',
      bodyText: 'Cuerpo 1',
      receivedAt: new Date('2026-10-20T14:00:00Z'),
      attachments: [],
    });
    expect(emails[1]?.attachments).toEqual([
      { filename: 'pago_30711111111_100.pdf', mimeType: 'application/pdf', content: new Uint8Array([9]), inline: false },
    ]);
    expect(await mailbox.fetchSince(new Date('2026-10-21T00:00:00Z'))).toEqual([]);
  });

  it('RF-194: no se conecta a Gmail ni a ningún servicio externo', async () => {
    const db = createTestDb();
    const { sender, mailbox, addReceived } = createMockMail(db, fixedClock('2026-10-20T13:00:00Z'));
    await sender.send({ fromName: 'X', to: 'a@b.com', subject: 's', text: 't' });
    addReceived({ from: 'a@b.com', subject: 's', body: 'b', attachments: [] });
    await mailbox.fetchSince(new Date('2026-10-01T00:00:00Z'));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
