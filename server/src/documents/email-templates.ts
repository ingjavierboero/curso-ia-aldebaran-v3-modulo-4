import type { OutgoingEmail } from '../adapters/types.ts';

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
