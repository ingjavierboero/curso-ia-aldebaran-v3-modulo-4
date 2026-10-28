import { type Request, Router } from 'express';
import type { AppContext } from '../../context.ts';
import { certificateBanner, exchangeRateBanner, processErrorsBanner } from '../../services/banners.ts';
import { ClientNotFoundError } from '../../services/clients.ts';
import { listDebtors } from '../../services/debt.ts';
import { confirmFallback } from '../../services/exchange-rates.ts';
import { ReminderBlockedError, ReminderSendError, sendReminder } from '../../services/reminders.ts';
import { AppError, notFound, unprocessable } from '../errors.ts';
import { canEdit } from '../middleware/require-role.ts';
import { currentUser } from '../middleware/session.ts';
import type { DashboardDto } from '../types.ts';
import { idParam } from '../validate.ts';

/** Con un middleware antes del handler, Express no infiere el tipo de `:id` desde la ruta. */
type WithId = Request<{ id: string }>;

/**
 * Dashboard: clientes con deuda vigente (RF-153), banners de certificado, cotización y errores (RF-69,
 * RF-97, RF-98, RF-181) y el recordatorio manual, que puede enviar cualquier perfil (RF-12, RF-154).
 */
export function dashboardRouter(ctx: AppContext): Router {
  const router = Router();

  const dashboard = async (): Promise<DashboardDto> => ({
    banners: {
      certificate: await certificateBanner(ctx),
      exchangeRate: exchangeRateBanner(ctx.db),
      processErrors: processErrorsBanner(ctx.db),
    },
    debtors: listDebtors(ctx.db),
  });

  router.get('/dashboard', async (_req, res) => {
    res.json(await dashboard());
  });

  // RF-70: un Admin o un Editor confirma la cotización de respaldo.
  router.post('/dashboard/exchange-rate/confirm', canEdit(), async (_req, res) => {
    confirmFallback(ctx.db, currentUser(res).id, ctx.adapters.clock.now());
    res.json(await dashboard());
  });

  // RF-154, RF-156, RF-157, RF-96: recordatorio manual, bloqueado con un mensaje si no corresponde.
  router.post('/clients/:id/reminder', async (req: WithId, res) => {
    try {
      const { sentAt } = await sendReminder(ctx, {
        clientId: idParam(req.params.id),
        trigger: 'manual',
        userId: currentUser(res).id,
      });
      res.json({ status: 'enviado', sentAt });
    } catch (error) {
      if (error instanceof ClientNotFoundError) throw notFound(error.message);
      if (error instanceof ReminderBlockedError) throw unprocessable(error.code, error.message);
      if (error instanceof ReminderSendError) throw new AppError(502, 'envio_fallido', error.message);
      throw error;
    }
  });

  return router;
}
