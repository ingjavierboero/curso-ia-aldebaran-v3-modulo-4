import PDFDocument from 'pdfkit';
import { CLIENT_IVA_CONDITIONS, type ClientIvaCondition, type Mode } from '../http/types.ts';
import {
  formatCuit,
  formatDate,
  formatInstantDate,
  formatMoney,
  formatPeriod,
  formatVoucherNumber,
} from './format.ts';

/** Datos de una factura emitida, tal como se guardaron al emitirla (copias del cliente y del emisor). */
export interface InvoicePdfData {
  mode: Mode;
  issuer: {
    cuit: string;
    businessName: string;
    /** Solo para los emails: el PDF muestra la razón social (RF-92, RF-215). */
    tradeName: string | null;
    address: string;
    ivaCondition: string;
    grossIncomeNumber: string;
    activityStartDate: string;
  };
  client: { businessName: string; cuit: string; address: string; ivaCondition: number };
  voucherType: 11;
  pointOfSale: number;
  number: number;
  issueDate: string;
  period: string;
  serviceFrom: string;
  serviceTo: string;
  dueDate: string;
  items: Array<{
    description: string;
    originalPriceCents: number;
    originalCurrency: 'ARS' | 'USD';
    amountCents: number;
  }>;
  totalCents: number;
  cae: string;
  caeDueDate: string;
  /** Cotización usada si algún ítem estaba en dólares (RF-93). */
  exchangeRate: { rateCents: number; source: string; readAt: string } | null;
}

export const HOMOLOGATION_NOTICE =
  'Comprobante emitido en el ambiente de homologación de ARCA: no tiene validez fiscal.'; // RF-90

const MARGIN = 50;
const PAGE_WIDTH = 595.28; // A4
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const ivaLabel = (code: number) => CLIENT_IVA_CONDITIONS[code as ClientIvaCondition] ?? String(code);

/**
 * PDF de una Factura C con todos los datos de RF-93, los datos de la empresa emisora y su CUIT sin el
 * nombre de fantasía (RF-92) y la leyenda de homologación (RF-90).
 */
export function renderInvoicePdf(data: InvoicePdfData): Promise<Uint8Array> {
  const title = `Factura C ${formatVoucherNumber(data.pointOfSale, data.number)}`;
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, info: { Title: title } });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Uint8Array>((resolve, reject) => {
    doc.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on('error', reject);
  });

  const label = (text: string, value: string) => {
    doc.font('Helvetica-Bold').text(`${text}: `, { continued: true }).font('Helvetica').text(value);
  };
  const section = (title: string) => {
    doc.moveDown(0.8).font('Helvetica-Bold').fontSize(11).text(title).fontSize(10).moveDown(0.2);
  };

  // Leyenda de homologación arriba, bien visible (RF-90).
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#b00020').text(HOMOLOGATION_NOTICE, { align: 'center' });
  doc.fillColor('black').moveDown(0.8);

  // Encabezado: tipo de comprobante, número y emisión.
  doc.font('Helvetica-Bold').fontSize(18).text('Factura C', { continued: true }).fontSize(10).text('   Código 11');
  doc.fontSize(10).moveDown(0.3);
  label('Punto de venta y número', formatVoucherNumber(data.pointOfSale, data.number));
  label('Fecha de emisión', formatDate(data.issueDate));

  // Empresa emisora (RF-92): sin el nombre de fantasía.
  section('Emisor');
  doc.font('Helvetica').text(data.issuer.businessName);
  label('CUIT', formatCuit(data.issuer.cuit));
  label('Domicilio comercial', data.issuer.address);
  label('Condición frente al IVA', data.issuer.ivaCondition);
  label('Ingresos brutos', data.issuer.grossIncomeNumber);
  label('Inicio de actividades', formatDate(data.issuer.activityStartDate));

  section('Cliente');
  doc.font('Helvetica').text(data.client.businessName);
  label('CUIT', formatCuit(data.client.cuit));
  label('Domicilio', data.client.address);
  label('Condición frente al IVA', ivaLabel(data.client.ivaCondition));

  section('Período facturado');
  label('Período', formatPeriod(data.period));
  label('Servicio', `del ${formatDate(data.serviceFrom)} al ${formatDate(data.serviceTo)}`);
  label('Vencimiento del pago', formatDate(data.dueDate));

  // Detalle de cada cuota mensual, con el precio original si estaba en dólares.
  section('Detalle');
  for (const item of data.items) {
    const y = doc.y;
    const original = item.originalCurrency === 'USD' ? ` (${formatMoney(item.originalPriceCents, 'USD')})` : '';
    const detail = `${item.description}${original}`;
    doc.font('Helvetica').text(detail, MARGIN, y, { width: CONTENT_WIDTH - 140 });
    doc.text(formatMoney(item.amountCents), MARGIN + CONTENT_WIDTH - 140, y, { width: 140, align: 'right' });
    doc.x = MARGIN;
  }
  doc.moveDown(0.5).font('Helvetica-Bold').fontSize(12);
  doc.text(`Total: ${formatMoney(data.totalCents)}`, MARGIN, doc.y, { width: CONTENT_WIDTH, align: 'right' });
  doc.fontSize(10).x = MARGIN;

  if (data.exchangeRate) {
    const { rateCents, source, readAt } = data.exchangeRate;
    doc.moveDown(0.5).font('Helvetica').text(
      `Cuotas en dólares convertidas con la cotización del dólar blue venta de ${formatMoney(rateCents)}, ` +
        `fuente ${source}, leída el ${formatInstantDate(readAt)}.`,
      MARGIN,
      doc.y,
      { width: CONTENT_WIDTH },
    );
  }

  section('Autorización de ARCA');
  label('CAE', data.cae);
  label('Vencimiento del CAE', formatDate(data.caeDueDate));

  doc.end();
  return done;
}
