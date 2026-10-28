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
import { notFound } from '../errors.ts';
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
 * facturas están en `POST /api/invoices/:id/status`; los errores de proceso se suman en US7.
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

  return router;
}
