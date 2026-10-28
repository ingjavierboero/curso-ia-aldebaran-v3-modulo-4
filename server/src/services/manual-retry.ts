import { eq } from 'drizzle-orm';
import type { AppContext } from '../context.ts';
import { clients } from '../db/schema.ts';
import { activeProducts, generateInvoice } from './billing.ts';
import { sendInvoiceEmail } from './invoice-email.ts';
import { pendingError, recordFailedRetry, recordProcessError, resolveProcessError } from './process-errors.ts';
import { ReminderSendError, sendReminder } from './reminders.ts';

/** El error no admite reintento manual (por ejemplo, la revisión de la casilla, RF-104). */
export class NotRetryableError extends Error {}
/** RF-177: el cliente ya no es facturable; el error sigue Pendiente. */
export class ClientNotBillableError extends Error {}
/** El único intento del reintento manual falló; el mensaje es para el usuario (RF-182). */
export class RetryFailedError extends Error {}

/**
 * Reintento manual de un error de proceso Pendiente (RF-176 a RF-179, FR-046): un único intento, sin
 * pasar por la cola de reintentos (RF-183). Si tiene éxito, el error pasa a Resuelto; si falla, sigue
 * Pendiente con el nuevo mensaje y se lanza RetryFailedError. Un recordatorio que ya no corresponde
 * lanza ReminderBlockedError sin tocar el error.
 */
export async function retryProcessError(ctx: AppContext, errorId: number, userId: number): Promise<void> {
  const { db, adapters } = ctx;
  const error = pendingError(db, errorId);
  const now = () => adapters.clock.now();
  const fail = (message: string): never => {
    recordFailedRetry(db, errorId, message, now());
    throw new RetryFailedError(message);
  };
  const resolve = () => resolveProcessError(db, errorId, { by: 'reintento_manual', userId, now: now() });

  switch (error.operation) {
    case 'generacion_factura': {
      const clientId = error.clientId ?? 0;
      const period = error.period ?? '';
      const client = db.select().from(clients).where(eq(clients.id, clientId)).get();
      if (!client || client.status !== 'activo') {
        throw new ClientNotBillableError('El cliente está Inactivo: no se puede generar su factura.');
      }
      if (activeProducts(db, clientId).length === 0) {
        throw new ClientNotBillableError(
          'El cliente no tiene productos Activos asignados: no se puede generar su factura.',
        );
      }
      const result = await generateInvoice(ctx, { clientId, period });
      if (result.status === 'fallida') fail(result.message);
      if (result.status !== 'generada') return;
      resolve();
      // RF-177: la factura generada se envía enseguida. Si el email falla, queda su propio error de envío.
      const sent = await sendInvoiceEmail(ctx, result.invoiceId, 'reintento_manual', userId);
      if (sent.status === 'fallido') {
        recordProcessError(db, {
          operation: 'envio_factura',
          clientId,
          period,
          invoiceId: result.invoiceId,
          attempts: 1,
          message: sent.message,
          now: now(),
        });
        throw new RetryFailedError(`La factura se generó, pero no se pudo enviar el email: ${sent.message}`);
      }
      return;
    }
    case 'envio_factura': {
      // RF-178: solo se reenvía el email, sin volver a generar la factura.
      const sent = await sendInvoiceEmail(ctx, error.invoiceId ?? 0, 'reintento_manual', userId);
      if (sent.status === 'fallido') fail(sent.message);
      if (sent.status === 'omitido') throw new NotRetryableError(`No se puede reenviar el email: ${sent.reason}.`);
      resolve();
      return;
    }
    case 'envio_recordatorio': {
      try {
        await sendReminder(ctx, {
          clientId: error.clientId ?? 0,
          trigger: 'reintento_manual',
          userId,
          reminderMonth: error.period ?? undefined,
        });
      } catch (e) {
        if (e instanceof ReminderSendError) fail(e.message);
        throw e;
      }
      resolve();
      return;
    }
    case 'revision_casilla':
      throw new NotRetryableError('La revisión de la casilla se reintenta sola en la siguiente revisión.');
  }
}
