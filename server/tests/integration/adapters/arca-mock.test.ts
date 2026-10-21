import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockArcaClient } from '../../../src/adapters/arca/mock.ts';
import type { CaeRequest } from '../../../src/adapters/types.ts';
import { createTestDb, insertClient, insertInvoice } from '../../helpers/test-db.ts';

const request: CaeRequest = {
  pointOfSale: 3,
  voucherType: 11,
  number: 1,
  issueDate: '2026-10-25',
  serviceFrom: '2026-10-01',
  serviceTo: '2026-10-31',
  dueDate: '2026-10-31',
  receiverCuit: '30711111111',
  receiverIvaCondition: 1,
  totalCents: 100_000,
};

describe('ARCA simulado (RF-185, RF-186)', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => vi.stubGlobal('fetch', fetchSpy));
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchSpy.mockReset();
  });

  it('AC-196: sin facturas emitidas en un punto de venta, la numeración empieza en 1', async () => {
    const arca = createMockArcaClient(createTestDb());
    expect(await arca.lastAuthorizedNumber(3, 11)).toBe(0);
  });

  it('AC-196: otorga un CAE de 14 dígitos que vence 10 días después de la fecha de emisión', async () => {
    const arca = createMockArcaClient(createTestDb());
    const first = await arca.requestCae(request);
    expect(first.cae).toMatch(/^\d{14}$/);
    expect(first.caeDueDate).toBe('2026-11-04');

    const endOfYear = await arca.requestCae({ ...request, issueDate: '2026-12-28' });
    expect(endOfYear.caeDueDate).toBe('2027-01-07');
  });

  it('AC-196: el último número autorizado sale de las facturas con CAE de la base mock, por punto de venta', async () => {
    const db = createTestDb();
    const client = insertClient(db);
    insertInvoice(db, { clientId: client.id, period: '2026-09', pointOfSale: 3, number: 1, cae: '12345678901234' });
    insertInvoice(db, { clientId: client.id, period: '2026-10', pointOfSale: 3, number: 2, cae: '12345678901235' });
    insertInvoice(db, { clientId: insertClient(db).id, period: '2026-10', pointOfSale: 5, number: 1, cae: '12345678901236' });
    // Una factura que todavía no obtuvo CAE no cuenta como autorizada.
    insertInvoice(db, {
      clientId: insertClient(db).id,
      period: '2026-10',
      pointOfSale: 3,
      number: 3,
      cae: null,
      status: 'generando',
    });

    const arca = createMockArcaClient(db);
    expect(await arca.lastAuthorizedNumber(3, 11)).toBe(2);
    expect(await arca.lastAuthorizedNumber(5, 11)).toBe(1);
    expect(await arca.lastAuthorizedNumber(7, 11)).toBe(0);
  });

  it('findVoucher devuelve el comprobante autorizado de ese punto de venta y número, o null', async () => {
    const db = createTestDb();
    const client = insertClient(db, { cuit: '30711111111' });
    insertInvoice(db, {
      clientId: client.id,
      period: '2026-10',
      pointOfSale: 3,
      number: 2,
      cae: '12345678901235',
      caeDueDate: '2026-10-25',
      totalCents: 100_000,
      clientSnapshot: { cuit: '30711111111' },
    });

    const arca = createMockArcaClient(db);
    expect(await arca.findVoucher(3, 11, 2)).toEqual({
      cae: '12345678901235',
      caeDueDate: '2026-10-25',
      totalCents: 100_000,
      receiverCuit: '30711111111',
    });
    expect(await arca.findVoucher(3, 11, 9)).toBeNull();
    expect(await arca.findVoucher(5, 11, 2)).toBeNull();
  });

  it('RF-185: no se conecta a ARCA (ni a WSAA ni a WSFEv1)', async () => {
    const arca = createMockArcaClient(createTestDb());
    await arca.lastAuthorizedNumber(3, 11);
    await arca.requestCae(request);
    await arca.findVoucher(3, 11, 1);
    await arca.certificateStatus();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
