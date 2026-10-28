import { type Request, Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.ts';
import { invoiceDetail, invoicePdfOf, listInvoices } from '../../services/invoices.ts';
import {
  changeInvoiceStatus,
  InvoiceNotFoundError,
  StatusConflictError,
  UserTransitionError,
} from '../../services/review.ts';
import { AppError, conflict, notFound } from '../errors.ts';
import { canEdit } from '../middleware/require-role.ts';
import { currentUser } from '../middleware/session.ts';
import { period } from '../schemas.ts';
import { idParam, parse } from '../validate.ts';

/** RF-143 a RF-147: un usuario solo pasa facturas a Pagada o a Pendiente de pago. */
const statusChange = z.object({
  to: z.enum(['pagada', 'pendiente_de_pago'], { error: 'El estado nuevo debe ser Pagada o Pendiente de pago.' }),
  // RF-218: el estado que el usuario vio al abrir la pantalla.
  expectedStatus: z.enum(['generando', 'pendiente_de_pago', 'pago_recibido', 'revision_manual', 'pagada'], {
    error: 'Falta el estado que tenía la factura (expectedStatus).',
  }),
});

/** Filtros del listado de facturas (RF-168). */
const listFilters = z.object({
  status: z
    .enum(['pendiente_de_pago', 'pago_recibido', 'revision_manual', 'pagada'], { error: 'El estado no es válido.' })
    .optional(),
  clientId: z.coerce.number().int().positive('El cliente no es válido.').optional(),
  period: period('El período no es válido: tiene que ser AAAA-MM.').optional(),
});

/** Traduce los errores del cambio de estado a respuestas de la API. */
function toHttpError(error: unknown): unknown {
  if (error instanceof StatusConflictError) {
    return conflict('estado_cambiado', error.message, { currentStatus: error.currentStatus });
  }
  if (error instanceof UserTransitionError) return new AppError(422, 'transicion_invalida', error.message);
  if (error instanceof InvoiceNotFoundError) return notFound(error.message);
  return error;
}

/**
 * Facturas emitidas (RF-160): todos los perfiles las ven, de la más reciente a la más antigua. Las que
 * todavía se están generando no se muestran. Se filtran por estado, cliente y período (RF-168); cada una
 * tiene su detalle (RF-217) y su PDF (RF-162). Admin y Editor cambian su estado (RF-143 a RF-147).
 */
export function invoicesRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/invoices', (req, res) => {
    res.json(listInvoices(ctx.db, parse(listFilters, req.query)));
  });

  router.get('/invoices/:id', (req, res) => {
    const id = idParam(req.params.id);
    try {
      res.json(invoiceDetail(ctx.db, id));
    } catch (error) {
      throw toHttpError(error);
    }
  });

  // RF-162: cualquier perfil descarga el PDF de una factura emitida.
  router.get('/invoices/:id/pdf', async (req, res) => {
    const id = idParam(req.params.id);
    let pdf: { filename: string; content: Uint8Array };
    try {
      pdf = await invoicePdfOf(ctx, id);
    } catch (error) {
      throw toHttpError(error);
    }
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${pdf.filename}"`,
      'Cache-Control': 'private, no-store',
    });
    res.end(Buffer.from(pdf.content));
  });

  // RF-143 a RF-147, RF-218: cambio de estado que hace un Admin o un Editor, con control optimista.
  router.post('/invoices/:id/status', canEdit(), (req: Request<{ id: string }>, res) => {
    const invoiceId = idParam(req.params.id);
    const { to, expectedStatus } = parse(statusChange, req.body);
    try {
      const userId = currentUser(res).id;
      res.json(changeInvoiceStatus(ctx.db, { invoiceId, to, expectedStatus, userId, now: ctx.adapters.clock.now() }));
    } catch (error) {
      throw toHttpError(error);
    }
  });

  return router;
}
