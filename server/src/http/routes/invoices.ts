import { desc, eq, ne } from 'drizzle-orm';
import { Router } from 'express';
import type { AppContext } from '../../context.ts';
import { clients, invoices } from '../../db/schema.ts';
import { formatVoucherNumber } from '../../documents/format.ts';
import type { InvoiceDto, InvoiceStatus } from '../types.ts';

/**
 * Facturas emitidas (RF-160): todos los perfiles las ven, de la más reciente a la más antigua. Las que
 * todavía se están generando no se muestran. Los filtros, el detalle y el PDF se suman en T132.
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

  return router;
}
