import { type Request, Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.ts';
import {
  listNotices,
  listPayments,
  listResolved,
  markNoticeReviewed,
  NoticeNotFoundError,
} from '../../services/review.ts';
import {
  ClientNotBillableError,
  NotRetryableError,
  RetryFailedError,
  retryProcessError,
} from '../../services/manual-retry.ts';
import {
  listPendingErrors,
  ProcessErrorNotFoundError,
  ProcessErrorResolvedError,
  resolveProcessError,
} from '../../services/process-errors.ts';
import { ReminderBlockedError } from '../../services/reminders.ts';
import { AppError, conflict, notFound, unprocessable } from '../errors.ts';
import { canEdit } from '../middleware/require-role.ts';
import { currentUser } from '../middleware/session.ts';
import { calendarDate } from '../schemas.ts';
import { idParam, parse } from '../validate.ts';

const resolvedFilters = z.object({
  clientId: z.coerce.number().int().positive().optional(),
  from: calendarDate('La fecha desde no es válida.').optional(),
  to: calendarDate('La fecha hasta no es válida.').optional(),
});

/** Con un middleware antes del handler, Express no infiere el tipo de `:id` desde la ruta. */
type WithId = Request<{ id: string }>;

/**
 * Interfaz de revisión: todos los perfiles ven los pagos a revisar, los avisos y los resueltos; Admin y
 * Editor marcan los avisos como Revisados (RF-141, RF-142, RF-148, RF-216). Los cambios de estado de las
 * facturas están en `POST /api/invoices/:id/status`. Los errores de proceso Pendientes se listan para
 * todos; Admin y Editor los reintentan a mano o los marcan Resueltos (RF-175 a RF-180).
 */
export function reviewRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/review/payments', (_req, res) => {
    res.json(listPayments(ctx.db));
  });

  router.get('/review/notices', (_req, res) => {
    res.json(listNotices(ctx.db));
  });

  router.post('/review/notices/:id/reviewed', canEdit(), (req: WithId, res) => {
    const id = idParam(req.params.id);
    try {
      markNoticeReviewed(ctx.db, id, currentUser(res).id, ctx.adapters.clock.now());
    } catch (error) {
      throw error instanceof NoticeNotFoundError ? notFound(error.message) : error;
    }
    res.json({ id, status: 'revisado' });
  });

  router.get('/review/resolved', (req, res) => {
    res.json(listResolved(ctx.db, parse(resolvedFilters, req.query)));
  });

  router.get('/review/errors', (_req, res) => {
    res.json(listPendingErrors(ctx.db));
  });

  router.post('/review/errors/:id/retry', canEdit(), async (req: WithId, res) => {
    try {
      await retryProcessError(ctx, idParam(req.params.id), currentUser(res).id);
    } catch (error) {
      throw processErrorFailure(error);
    }
    res.json({ status: 'resuelto' });
  });

  router.post('/review/errors/:id/resolve', canEdit(), (req: WithId, res) => {
    try {
      resolveProcessError(ctx.db, idParam(req.params.id), {
        by: 'usuario',
        userId: currentUser(res).id,
        now: ctx.adapters.clock.now(),
      });
    } catch (error) {
      throw processErrorFailure(error);
    }
    res.json({ status: 'resuelto' });
  });

  return router;
}

/** Traduce los errores del reintento manual y de la resolución a respuestas HTTP (RF-182). */
function processErrorFailure(error: unknown): unknown {
  if (error instanceof ProcessErrorNotFoundError) return notFound(error.message);
  if (error instanceof ProcessErrorResolvedError) return conflict('error_resuelto', error.message);
  if (error instanceof ClientNotBillableError) return unprocessable('cliente_no_facturable', error.message);
  if (error instanceof NotRetryableError) return unprocessable('no_reintentable', error.message);
  if (error instanceof ReminderBlockedError) return unprocessable(error.code, error.message);
  if (error instanceof RetryFailedError) return new AppError(502, 'reintento_fallido', error.message);
  return error;
}
