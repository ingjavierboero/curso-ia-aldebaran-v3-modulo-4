import { describe, expect, it } from 'vitest';
import { type InvoicePdfData, renderInvoicePdf } from '../../../src/documents/invoice-pdf.ts';
import { pdfText } from '../../helpers/pdf-text.ts';

/** Factura de octubre con un ítem en pesos y otro en dólares (USD 30 a $1.555,50). */
const INVOICE: InvoicePdfData = {
  mode: 'homologacion',
  issuer: {
    cuit: '20111111112',
    businessName: 'Molina Hernando Agustina Maria',
    tradeName: 'Estudio Molina',
    address: 'Calle Falsa 123, CABA',
    ivaCondition: 'Responsable Monotributo',
    grossIncomeNumber: '901-123456-7',
    activityStartDate: '2020-01-01',
  },
  client: {
    businessName: 'Los Andes SRL',
    cuit: '30711111111',
    address: 'Av. Corrientes 1234, CABA',
    ivaCondition: 1,
  },
  voucherType: 11,
  pointOfSale: 3,
  number: 1,
  issueDate: '2026-10-15',
  period: '2026-10',
  serviceFrom: '2026-10-01',
  serviceTo: '2026-10-31',
  dueDate: '2026-10-31',
  items: [
    { description: 'Abono mensual', originalPriceCents: 15_000_000, originalCurrency: 'ARS', amountCents: 15_000_000 },
    { description: 'Soporte', originalPriceCents: 3_000, originalCurrency: 'USD', amountCents: 4_666_500 },
  ],
  totalCents: 19_666_500,
  cae: '70000000000001',
  caeDueDate: '2026-10-25',
  exchangeRate: { rateCents: 155_550, source: 'dolarhoy.com', readAt: '2026-10-15T14:00:00.000Z' },
};

/** Texto del PDF en una sola línea, con espacios normales. */
async function textOf(data: InvoicePdfData): Promise<string> {
  return pdfText(await renderInvoicePdf(data)).replace(/\s+/g, ' ');
}

describe('PDF de la factura (RF-93)', () => {
  it('es un archivo PDF', async () => {
    const pdf = await renderInvoicePdf(INVOICE);
    expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('AC-84: incluye la razón social, el CUIT, el domicilio y la condición frente al IVA del cliente', async () => {
    const text = await textOf(INVOICE);
    expect(text).toContain('Los Andes SRL');
    expect(text).toContain('30-71111111-1');
    expect(text).toContain('Av. Corrientes 1234, CABA');
    expect(text).toContain('IVA Responsable Inscripto');
  });

  it('AC-84: incluye Factura C, el punto de venta, el número, la emisión, el período, el servicio y el vencimiento', async () => {
    const text = await textOf(INVOICE);
    expect(text).toContain('Factura C');
    expect(text).toContain('00003-00000001');
    expect(text).toContain('15/10/2026');
    expect(text).toMatch(/octubre (de )?2026/i);
    expect(text).toContain('01/10/2026');
    expect(text).toContain('31/10/2026');
  });

  it('AC-84: incluye el detalle de cada cuota, el total en pesos, el CAE y su vencimiento', async () => {
    const text = await textOf(INVOICE);
    expect(text).toContain('Abono mensual');
    expect(text).toContain('$ 150.000,00');
    expect(text).toContain('Soporte');
    expect(text).toContain('$ 46.665,00');
    expect(text).toContain('$ 196.665,00');
    expect(text).toContain('70000000000001');
    expect(text).toContain('25/10/2026');
  });

  it('AC-84: si algún ítem estaba en dólares, indica la cotización usada, su fuente y la cuota original en dólares', async () => {
    const text = await textOf(INVOICE);
    expect(text).toMatch(/cotización/i);
    expect(text).toContain('$ 1.555,50');
    expect(text).toContain('dolarhoy.com');
    expect(text).toContain('US$ 30,00');
  });

  it('sin ítems en dólares no menciona ninguna cotización', async () => {
    const text = await textOf({
      ...INVOICE,
      items: [INVOICE.items[0]!],
      totalCents: 15_000_000,
      exchangeRate: null,
    });
    expect(text).not.toMatch(/cotización/i);
    expect(text).not.toContain('dolarhoy.com');
  });
});

describe('datos de la empresa emisora (RF-92)', () => {
  it('AC-83: incluye la razón social, el domicilio, la condición frente al IVA, los ingresos brutos, el inicio de actividades y el CUIT', async () => {
    const text = await textOf(INVOICE);
    expect(text).toContain('Molina Hernando Agustina Maria');
    expect(text).toContain('Calle Falsa 123, CABA');
    expect(text).toContain('Responsable Monotributo');
    expect(text).toContain('901-123456-7');
    expect(text).toContain('01/01/2020');
    expect(text).toContain('20-11111111-2');
  });

  it('RF-92, AC-237: el PDF no muestra el nombre de fantasía', async () => {
    expect(await textOf(INVOICE)).not.toContain('Estudio Molina');
  });
});

describe('leyenda de homologación (RF-90)', () => {
  it('AC-82: indica que el comprobante se emitió en homologación y no tiene validez fiscal', async () => {
    const text = await textOf(INVOICE);
    expect(text).toMatch(/homologación/i);
    expect(text).toMatch(/no tiene validez fiscal/i);
  });
});
