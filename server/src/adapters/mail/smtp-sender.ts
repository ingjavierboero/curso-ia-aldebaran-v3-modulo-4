import nodemailer from 'nodemailer';
import type { Env } from '../../config/env.ts';
import { type MailSender, TimeoutError } from '../types.ts';

/** Límite de espera del servidor de email (RNF-07). */
export const SMTP_TIMEOUT_MS = 30_000;

/** Lo mínimo de nodemailer que usa el sender; los tests inyectan un transporte falso. */
interface Transport {
  sendMail(mail: Record<string, unknown>): Promise<{ messageId: string }>;
}
type CreateTransport = (options: Record<string, unknown>) => Transport;

const defaultCreateTransport: CreateTransport = (options) =>
  nodemailer.createTransport(options) as unknown as Transport;

/** Corta la espera a los 30 s aunque nodemailer siga esperando en alguna etapa que no cubre. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError('El servidor de email no respondió a tiempo.')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Quita la contraseña de aplicación de cualquier mensaje de error (Constitución, Principio IV). */
function withoutSecret(error: unknown, secret: string | null): unknown {
  if (!(error instanceof Error) || !secret || !error.message.includes(secret)) return error;
  const clean = new Error(error.message.replaceAll(secret, '[oculto]'));
  clean.name = error.name;
  return clean;
}

/**
 * Envío de emails por el SMTP de Gmail con contraseña de aplicación (research R-08). Con
 * EMAIL_REDIRECT_TO (solo desarrollo), todos los emails van a esa casilla y el destinatario original
 * queda en el header X-Original-To.
 */
export function createSmtpSender(env: Env, options: { createTransport?: CreateTransport } = {}): MailSender {
  const transport = (options.createTransport ?? defaultCreateTransport)({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: env.gmailUser, pass: env.gmailAppPassword },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  });

  return {
    async send(msg) {
      const redirect = env.emailRedirectTo;
      const mail = {
        from: { name: msg.fromName, address: env.gmailUser ?? '' },
        to: redirect ?? msg.to,
        subject: msg.subject,
        text: msg.text,
        ...(msg.html !== undefined && { html: msg.html }),
        ...(redirect && { headers: { 'X-Original-To': msg.to } }),
        attachments: (msg.attachments ?? []).map((attachment) => ({
          filename: attachment.filename,
          contentType: attachment.mimeType,
          content: Buffer.from(attachment.content),
        })),
      };

      try {
        const info = await withTimeout(transport.sendMail(mail), SMTP_TIMEOUT_MS);
        return { messageId: info.messageId };
      } catch (error) {
        throw withoutSecret(error, env.gmailAppPassword);
      }
    },
  };
}
