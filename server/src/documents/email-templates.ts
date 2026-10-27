import type { OutgoingEmail } from '../adapters/types.ts';
import { formatDate, formatMoney, formatPeriod } from './format.ts';
import { HOMOLOGATION_NOTICE } from './invoice-pdf.ts';

/** Nombre del remitente de los emails internos del sistema, que no van a clientes (RF-215 no aplica). */
export const SYSTEM_SENDER_NAME = 'Aldebaran';

/** Email con el link de recuperación de contraseña (RF-24). El link vence a los `validMinutes`. */
export function passwordRecoveryEmail(input: {
  to: string;
  name: string;
  url: string;
  validMinutes: number;
}): OutgoingEmail {
  return {
    fromName: SYSTEM_SENDER_NAME,
    to: input.to,
    subject: 'Recuperación de contraseña de Aldebaran',
    text: [
      `Hola, ${input.name}:`,
      '',
      'Recibimos un pedido para restablecer tu contraseña de Aldebaran. Para elegir una nueva, entrá a:',
      '',
      input.url,
      '',
      `El link vence a los ${input.validMinutes} minutos y sirve una sola vez.`,
      'Si no lo pediste, ignorá este email: tu contraseña no cambia.',
    ].join('\n'),
  };
}

/** Datos del email de una factura (RF-84, RF-88 a RF-90, RF-215). */
export interface InvoiceEmailInput {
  to: string;
  clientName: string;
  /** Nombre de fantasía de la empresa emisora o, si no tiene, su razón social (RF-215). */
  senderName: string;
  voucherNumber: string;
  period: string;
  totalCents: number;
  dueDate: string;
  /** Deuda vigente total del cliente al momento del envío (RF-88). */
  debtCents: number;
  /** La deuda incluye facturas anteriores a esta (RF-88). */
  includesPrevious: boolean;
  pdf: { filename: string; content: Uint8Array };
}

/**
 * Email de una factura: la informa con su PDF adjunto, avisa la deuda pendiente y pide responder con el
 * comprobante de pago. Mientras se factura en homologación lo indica (RF-90).
 */
export function invoiceEmail(input: InvoiceEmailInput): OutgoingEmail {
  const debt = input.includesPrevious
    ? `Tenés una deuda pendiente de ${formatMoney(input.debtCents)}, que incluye facturas anteriores.`
    : `Tenés una deuda pendiente de ${formatMoney(input.debtCents)}.`;
  return {
    fromName: input.senderName,
    to: input.to,
    subject: `Factura C ${input.voucherNumber} - ${formatPeriod(input.period)}`,
    text: [
      `Hola, ${input.clientName}:`,
      '',
      `Te enviamos la Factura C ${input.voucherNumber} del período ${formatPeriod(input.period)}, ` +
        `por ${formatMoney(input.totalCents)}, con vencimiento el ${formatDate(input.dueDate)}. ` +
        'La encontrás adjunta en PDF.',
      '',
      debt,
      '',
      'Cuando hagas el pago, respondé este email adjuntando el comprobante de pago.',
      '',
      HOMOLOGATION_NOTICE,
      '',
      'Saludos,',
      input.senderName,
    ].join('\n'),
    attachments: [{ filename: input.pdf.filename, mimeType: 'application/pdf', content: input.pdf.content }],
  };
}
