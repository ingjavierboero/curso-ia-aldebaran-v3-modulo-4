import type { OutgoingEmail } from '../adapters/types.ts';
import type { Mode } from '../http/types.ts';
import { formatDate, formatMoney, formatPeriod } from './format.ts';
import { HOMOLOGATION_NOTICE, MOCK_NOTICE } from './invoice-pdf.ts';

/** Párrafos finales que todo email del modo mock lleva para indicar que es simulado (RF-210). */
export const mockNoticeLines = (mode: Mode): string[] => (mode === 'mock' ? [MOCK_NOTICE, ''] : []);

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
  mode: Mode;
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
 * comprobante de pago. Mientras se factura en homologación lo indica (RF-90) y, en modo mock, también
 * que es simulado (RF-210).
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
      ...mockNoticeLines(input.mode),
      'Saludos,',
      input.senderName,
    ].join('\n'),
    attachments: [{ filename: input.pdf.filename, mimeType: 'application/pdf', content: input.pdf.content }],
  };
}

/** Factura adeudada tal como se detalla en el recordatorio (RF-150). */
export interface ReminderInvoice {
  voucherNumber: string;
  period: string;
  totalCents: number;
  dueDate: string;
}

/** Datos del email recordatorio, automático o manual (RF-149 a RF-151, RF-215). */
export interface ReminderEmailInput {
  mode: Mode;
  to: string;
  clientName: string;
  /** Nombre de fantasía de la empresa emisora o, si no tiene, su razón social (RF-215). */
  senderName: string;
  /** Facturas adeudadas del cliente al momento del envío, de la más antigua a la más reciente. */
  invoices: ReminderInvoice[];
}

/**
 * Recordatorio de deuda: detalla cada factura adeudada con su número, período, importe y vencimiento, el
 * total a pagar y pide responder con el comprobante (RF-150, RF-151). No lleva la leyenda de homologación,
 * que es solo del email de la factura (RF-90); en modo mock indica que es simulado (RF-210).
 */
export function reminderEmail(input: ReminderEmailInput): OutgoingEmail {
  const totalCents = input.invoices.reduce((sum, invoice) => sum + invoice.totalCents, 0);
  return {
    fromName: input.senderName,
    to: input.to,
    subject: `Recordatorio de pago - ${input.senderName}`,
    text: [
      `Hola, ${input.clientName}:`,
      '',
      input.invoices.length === 1
        ? 'Te recordamos que tenés una factura pendiente de pago:'
        : 'Te recordamos que tenés estas facturas pendientes de pago:',
      '',
      ...input.invoices.map(
        (invoice) =>
          `- Factura C ${invoice.voucherNumber}, período ${formatPeriod(invoice.period)}: ` +
          `${formatMoney(invoice.totalCents)}, vence el ${formatDate(invoice.dueDate)}.`,
      ),
      '',
      `Total a pagar: ${formatMoney(totalCents)}.`,
      '',
      'Cuando hagas el pago, respondé este email adjuntando el comprobante de pago.',
      '',
      ...mockNoticeLines(input.mode),
      'Saludos,',
      input.senderName,
    ].join('\n'),
  };
}
