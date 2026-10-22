import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSmtpSender } from '../../../src/adapters/mail/smtp-sender.ts';
import { TimeoutError } from '../../../src/adapters/types.ts';
import { testEnv } from '../../helpers/test-app.ts';

/** Transporte de nodemailer falso: registra la configuración y cada sendMail. */
function fakeTransport(sendMail: (mail: Record<string, unknown>) => Promise<{ messageId: string }>) {
  const created: Array<Record<string, unknown>> = [];
  const sent: Array<Record<string, unknown>> = [];
  const createTransport = vi.fn((options: Record<string, unknown>) => {
    created.push(options);
    return {
      sendMail: (mail: Record<string, unknown>) => {
        sent.push(mail);
        return sendMail(mail);
      },
    };
  });
  return { createTransport, created, sent };
}

const ok = async () => ({ messageId: '<abc@gmail.com>' });

const message = {
  fromName: 'Estudio Molina',
  to: 'pagos@losandes.com',
  subject: 'Factura C 0003-00000001',
  text: 'Le enviamos la factura.',
  attachments: [{ filename: 'factura.pdf', mimeType: 'application/pdf', content: new Uint8Array([37, 80, 68, 70]) }],
};

afterEach(() => vi.useRealTimers());

describe('envío de emails por SMTP de Gmail (research R-08)', () => {
  it('AC-227, RNF-11: se conecta a Gmail con GMAIL_USER y GMAIL_APP_PASSWORD de las variables de entorno', async () => {
    const transport = fakeTransport(ok);
    const env = testEnv({ gmailUser: 'facturacion@empresa.com', gmailAppPassword: 'valor-de-prueba-smtp' });
    createSmtpSender(env, { createTransport: transport.createTransport });

    expect(transport.created).toHaveLength(1);
    expect(transport.created[0]).toMatchObject({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: 'facturacion@empresa.com', pass: 'valor-de-prueba-smtp' },
    });
  });

  it('envía desde la casilla del sistema con el nombre indicado, al destinatario, con asunto, cuerpo y adjuntos', async () => {
    const transport = fakeTransport(ok);
    const env = testEnv({ gmailUser: 'facturacion@empresa.com' });
    const sender = createSmtpSender(env, { createTransport: transport.createTransport });

    const result = await sender.send(message);
    expect(result).toEqual({ messageId: '<abc@gmail.com>' });
    expect(transport.sent[0]).toMatchObject({
      from: { name: 'Estudio Molina', address: 'facturacion@empresa.com' },
      to: 'pagos@losandes.com',
      subject: 'Factura C 0003-00000001',
      text: 'Le enviamos la factura.',
    });
    const [attachment] = transport.sent[0]?.attachments as Array<{ filename: string; contentType: string; content: Buffer }>;
    expect(attachment).toMatchObject({ filename: 'factura.pdf', contentType: 'application/pdf' });
    expect([...(attachment?.content ?? [])]).toEqual([37, 80, 68, 70]);
  });

  it('EMAIL_REDIRECT_TO (solo desarrollo): manda todos los emails a esa casilla en lugar del destinatario real', async () => {
    const transport = fakeTransport(ok);
    const env = testEnv({ emailRedirectTo: 'dev@empresa.com' });
    const sender = createSmtpSender(env, { createTransport: transport.createTransport });

    await sender.send(message);
    expect(transport.sent[0]?.to).toBe('dev@empresa.com');
    // El destinatario original queda a la vista para poder revisar el email redirigido.
    expect(transport.sent[0]?.headers).toMatchObject({ 'X-Original-To': 'pagos@losandes.com' });
  });

  it('AC-228, RNF-07: si el servidor no responde, da el envío por fallido a los 30 s', async () => {
    vi.useFakeTimers();
    const transport = fakeTransport(() => new Promise(() => {}));
    const sender = createSmtpSender(testEnv(), { createTransport: transport.createTransport });

    let failure: unknown;
    let settled = false;
    sender.send(message).catch((error: unknown) => {
      failure = error;
    }).finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(29_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(settled).toBe(true);
    expect(failure).toBeInstanceOf(TimeoutError);
  });

  it('AC-228: también le indica a nodemailer los timeouts de 30 s de conexión y de respuesta', () => {
    const transport = fakeTransport(ok);
    createSmtpSender(testEnv(), { createTransport: transport.createTransport });
    expect(transport.created[0]).toMatchObject({ connectionTimeout: 30_000, greetingTimeout: 30_000, socketTimeout: 30_000 });
  });

  it('un rechazo del servidor se propaga sin incluir la contraseña de aplicación (Constitución IV)', async () => {
    const env = testEnv({ gmailAppPassword: 'valor-secreto-smtp' });
    const transport = fakeTransport(async () => {
      throw new Error('535 Invalid login: valor-secreto-smtp');
    });
    const sender = createSmtpSender(env, { createTransport: transport.createTransport });

    const error = await sender.send(message).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).not.toContain('valor-secreto-smtp');
  });
});
