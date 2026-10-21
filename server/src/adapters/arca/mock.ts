import { randomInt } from 'node:crypto';
import { and, eq, isNotNull, max } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { invoices } from '../../db/schema.ts';
import { addDays } from '../../domain/billing-dates.ts';
import type { ArcaClient } from '../types.ts';

/** Días de vigencia del CAE ficticio (RF-186). */
const CAE_VALIDITY_DAYS = 10;

/**
 * ARCA simulado (RF-185, RF-186): no se conecta a ningún servicio y autoriza todas las facturas. La
 * numeración sale de las facturas con CAE de la base del modo mock, así sobrevive a los reinicios.
 */
export function createMockArcaClient(db: Db): ArcaClient {
  return {
    async lastAuthorizedNumber(pointOfSale) {
      const row = db
        .select({ last: max(invoices.number) })
        .from(invoices)
        .where(and(eq(invoices.pointOfSale, pointOfSale), isNotNull(invoices.cae)))
        .get();
      return row?.last ?? 0;
    },

    async requestCae(req) {
      // CAE ficticio de 14 dígitos, sin ceros a la izquierda.
      const cae = String(randomInt(1, 10)) + String(randomInt(0, 10 ** 13)).padStart(13, '0');
      return { cae, caeDueDate: addDays(req.issueDate, CAE_VALIDITY_DAYS) };
    },

    async findVoucher(pointOfSale, _voucherType, number) {
      const invoice = db
        .select()
        .from(invoices)
        .where(and(eq(invoices.pointOfSale, pointOfSale), eq(invoices.number, number), isNotNull(invoices.cae)))
        .get();
      if (!invoice?.cae || !invoice.caeDueDate) return null;
      const client = invoice.clientSnapshot as { cuit?: string };
      return {
        cae: invoice.cae,
        caeDueDate: invoice.caeDueDate,
        totalCents: invoice.totalCents,
        receiverCuit: client.cuit ?? '',
      };
    },

    async certificateStatus() {
      // En modo mock no hay certificado ni banner de certificado (RF-208).
      return { readable: true, notAfter: null };
    },
  };
}
