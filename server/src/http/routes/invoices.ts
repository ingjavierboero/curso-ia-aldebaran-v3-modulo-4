import { desc, eq, ne } from 'drizzle-orm';
import { type Request, Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.ts';
import { clients, invoices } from '../../db/schema.ts';
import { formatVoucherNumber } from '../../documents/format.ts';
import {
  changeInvoiceStatus,
  InvoiceNotFoundError,
  StatusConflictError,
  UserTransitionError,
} from '../../services/review.ts';
import { AppError, conflict, notFound } from '../errors.ts';
import { canEdit } from '../middleware/require-role.ts';
import { currentUser } from '../middleware/session.ts';
import type { InvoiceDto, InvoiceStatus } from '../types.ts';
import { idParam, parse } from '../validate.ts';

/** RF-143 a RF-147: un usuario solo pasa facturas a Pagada o a Pendiente de pago. */
const statusChange = z.object({
  to: z.enum(['pagada', 'pendiente_de_pago'], { error: 'El estado nuevo debe ser Pagada o Pendiente de pago.' }),
  // RF-218: el estado que el usuario vio al abrir la pantalla.
  expectedStatus: z.enum(['generando', 'pendiente_de_pago', 'pago_recibido', 'revision_manual', 'pagada'], {
    error: 'Falta el estado que tenía la factura (expectedStatus).',
  }),
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
 * todavía se están generando no se muestran. Admin y Editor cambian su estado (RF-143 a RF-147). Los
 * filtros, el detalle y el PDF se suman en T132.
 */
export function invoicesRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/invoices', (_req, res) => {
    const rows = ctx.db
      .select({ invoice: invoices, clientName: clients.businessName })
      .from(invoices)
      .innerJoin(clients, eq(invoices.clientId, clients.id))
      .where(ne(invoices.status, 'generando'))
      .orderBy(desc(invoices.issueDate), desc(invoices.id))
      .all();
    const list: InvoiceDto[] = rows.map(({ invoice, clientName }) => ({
      id: invoice.id,
      clientId: invoice.clientId,
      clientName,
      period: invoice.period,
      pointOfSale: invoice.pointOfSale,
      number: invoice.number,
      voucherNumber: invoice.number === null ? null : formatVoucherNumber(invoice.pointOfSale, invoice.number),
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      totalCents: invoice.totalCents,
      status: invoice.status as InvoiceStatus,
      cae: invoice.cae,
    }));
    res.json(list);
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
