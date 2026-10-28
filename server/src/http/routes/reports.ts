import { type Response, Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.ts';
import { csvMoney, toCsv } from '../../documents/csv.ts';
import { formatDate } from '../../documents/format.ts';
import { billingReport, collectionsReport, debtReport, type PeriodRange } from '../../services/reports.ts';
import { period } from '../schemas.ts';
import type { InvoiceStatus } from '../types.ts';
import { parse } from '../validate.ts';

const format = z.enum(['json', 'csv'], { error: 'El formato debe ser json o csv.' }).default('json');

/** Rango de períodos de los reportes de facturación y cobranza (RF-170). */
const rangeQuery = z
  .object({
    from: period('El período desde no es válido: tiene que ser AAAA-MM.').optional(),
    to: period('El período hasta no es válido: tiene que ser AAAA-MM.').optional(),
    format,
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, 'El período desde no puede ser posterior al período hasta.');

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  pendiente_de_pago: 'Pendiente de pago',
  pago_recibido: 'Pago recibido',
  revision_manual: 'Revisión manual',
  pagada: 'Pagada',
};

/** Nombre del archivo del reporte, con el rango si se filtró. */
function filename(report: string, range: PeriodRange = {}): string {
  const suffix = range.from || range.to ? `-${range.from ?? 'inicio'}-a-${range.to ?? 'hoy'}` : '';
  return `reporte-${report}${suffix}.csv`;
}

function sendCsv(res: Response, name: string, csv: string): void {
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` });
  res.send(csv);
}

/**
 * Reportes de facturación, cobranza y deuda (RF-164 a RF-167, RF-170): todos los perfiles los ven y los
 * descargan como CSV (`?format=csv`), con las mismas filas y columnas que en pantalla (AC-174).
 */
export function reportsRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/reports/billing', (req, res) => {
    const { format: as, ...range } = parse(rangeQuery, req.query);
    const rows = billingReport(ctx.db, range);
    if (as === 'json') return void res.json(rows);
    sendCsv(
      res,
      filename('facturacion', range),
      toCsv(
        ['Período', 'Facturas emitidas', 'Total facturado'],
        rows.map((row) => [row.period, row.invoiceCount, csvMoney(row.totalCents)]),
      ),
    );
  });

  router.get('/reports/collections', (req, res) => {
    const { format: as, ...range } = parse(rangeQuery, req.query);
    const rows = collectionsReport(ctx.db, range);
    if (as === 'json') return void res.json(rows);
    sendCsv(
      res,
      filename('cobranza', range),
      toCsv(
        ['Período', 'Total facturado', 'Pagada', 'Pago recibido', 'Adeudada'],
        rows.map((row) => [
          row.period,
          csvMoney(row.totalCents),
          csvMoney(row.paidCents),
          csvMoney(row.paymentReceivedCents),
          csvMoney(row.owedCents),
        ]),
      ),
    );
  });

  // En pantalla y en el CSV, una fila por factura adeudada, con el cliente y su total (AC-174).
  router.get('/reports/debt', (req, res) => {
    const { format: as } = parse(z.object({ format }), req.query);
    const rows = debtReport(ctx.db);
    if (as === 'json') return void res.json(rows);
    sendCsv(
      res,
      filename('deuda'),
      toCsv(
        ['Cliente', 'Deuda vigente', 'Factura', 'Período', 'Importe', 'Vencimiento', 'Estado'],
        rows.flatMap((client) =>
          client.invoices.map((invoice) => [
            client.businessName,
            csvMoney(client.debtCents),
            invoice.voucherNumber ?? '',
            invoice.period,
            csvMoney(invoice.totalCents),
            formatDate(invoice.dueDate),
            STATUS_LABELS[invoice.status],
          ]),
        ),
      ),
    );
  });

  return router;
}
