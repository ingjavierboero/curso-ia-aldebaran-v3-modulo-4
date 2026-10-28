import { describe, expect, it } from 'vitest';
import { decidePayment, type OwedInvoiceState, type PaymentInput } from '../../../src/domain/payment-rules.ts';

const CUIT = '30711111111';
const OTHER_CUIT = '20111111112';

const pending = (id: number, period: string, totalCents: number): OwedInvoiceState => ({
  id,
  period,
  totalCents,
  status: 'pendiente_de_pago',
});
const inReview = (id: number, period: string, totalCents: number): OwedInvoiceState => ({
  id,
  period,
  totalCents,
  status: 'revision_manual',
});

/** Comprobante tal como lo extrajo el LLM: CUIT y monto como texto, o null si no se pudieron extraer. */
const receipt = (cuit: string | null, amountRaw: string | null) => ({ cuit, amountRaw });

const decide = (input: Partial<PaymentInput>) =>
  decidePayment({ classification: 'si', clientCuit: CUIT, owedInvoices: [], receipts: [], ...input });

const ONE_DEBT = [pending(1, '2026-10', 1_000_000)];

describe('una regla por email (RF-126 a RF-137)', () => {
  it('AC-119, RF-126: un email "no" no cambia ninguna factura', () => {
    expect(decide({ classification: 'no', owedInvoices: ONE_DEBT })).toEqual({ rule: 'RF-126', action: 'ninguna' });
  });

  it('AC-120, AC-121, RF-127: sin deuda vigente, un email "si", "dudoso" o erróneo no cambia ninguna factura', () => {
    for (const classification of ['si', 'dudoso', 'error'] as const) {
      expect(decide({ classification, receipts: [receipt(CUIT, '10000')] }), classification).toEqual({
        rule: 'RF-127',
        action: 'ninguna',
      });
    }
  });

  it('AC-122, AC-123, RF-128: con el cliente en revisión, todas las adeudadas pasan a Revisión manual con "revisión manual pendiente", sin validar', () => {
    const owed = [inReview(1, '2026-09', 500_000), pending(2, '2026-10', 1_000_000)];
    for (const classification of ['si', 'dudoso', 'error'] as const) {
      // El comprobante coincide con la factura Pendiente de pago, pero no se valida.
      expect(decide({ classification, owedInvoices: owed, receipts: [receipt(CUIT, '10000')] }), classification).toEqual({
        rule: 'RF-128',
        action: 'revision_manual',
        reason: 'revisión manual pendiente',
        invoiceIds: [1, 2],
      });
    }
  });

  it('AC-125, RF-130: con procesamiento erróneo, las adeudadas pasan a Revisión manual con "no se pudo procesar el comprobante"', () => {
    expect(decide({ classification: 'error', owedInvoices: ONE_DEBT })).toEqual({
      rule: 'RF-130',
      action: 'revision_manual',
      reason: 'no se pudo procesar el comprobante',
      invoiceIds: [1],
    });
  });

  it('AC-126, RF-131: un email "dudoso" pasa las adeudadas a Revisión manual con "clasificación dudosa"', () => {
    expect(decide({ classification: 'dudoso', owedInvoices: ONE_DEBT })).toEqual({
      rule: 'RF-131',
      action: 'revision_manual',
      reason: 'clasificación dudosa',
      invoiceIds: [1],
    });
  });

  it('AC-128, AC-129, RF-132: sin CUIT o sin monto en algún comprobante, "no se pudieron extraer el CUIT o el monto"', () => {
    const missing = [
      [receipt(null, '10000')],
      [receipt(CUIT, null)],
      [receipt(CUIT, '10000'), receipt(null, '5000')],
      // RF-122: un CUIT que no tiene 11 dígitos cuenta como no extraído.
      [receipt('3071111111', '10000')],
    ];
    for (const receipts of missing) {
      expect(decide({ owedInvoices: ONE_DEBT, receipts }), JSON.stringify(receipts)).toEqual({
        rule: 'RF-132',
        action: 'revision_manual',
        reason: 'no se pudieron extraer el CUIT o el monto',
        invoiceIds: [1],
      });
    }
  });

  it('AC-130, RF-133: un CUIT distinto pasa las adeudadas a Revisión manual con "CUIT no coincide"', () => {
    expect(decide({ owedInvoices: ONE_DEBT, receipts: [receipt(OTHER_CUIT, '10000')] })).toEqual({
      rule: 'RF-133',
      action: 'revision_manual',
      reason: 'CUIT no coincide',
      invoiceIds: [1],
    });
  });

  it('AC-131: con dos comprobantes, basta con que uno tenga un CUIT distinto', () => {
    const owed = [pending(1, '2026-09', 10_000), pending(2, '2026-10', 20_000)];
    expect(decide({ owedInvoices: owed, receipts: [receipt(CUIT, '100'), receipt(OTHER_CUIT, '200')] })).toMatchObject({
      rule: 'RF-133',
      reason: 'CUIT no coincide',
      invoiceIds: [1, 2],
    });
  });

  it('AC-132, RF-125: el CUIT con guiones, puntos o espacios coincide si sus dígitos coinciden', () => {
    for (const cuit of ['30-71111111-1', '30.711.111.111', '30 71111111 1']) {
      expect(decide({ owedInvoices: ONE_DEBT, receipts: [receipt(cuit, '10000')] }), cuit).toEqual({
        rule: 'RF-134',
        action: 'pago_recibido',
        invoiceIds: [1],
      });
    }
  });

  it('AC-133, RF-134: validable con una única coincidencia, esas facturas pasan a Pago recibido', () => {
    expect(decide({ owedInvoices: ONE_DEBT, receipts: [receipt(CUIT, '10000.00')] })).toEqual({
      rule: 'RF-134',
      action: 'pago_recibido',
      invoiceIds: [1],
    });
  });

  it('AC-139, RF-135: validable con varias coincidencias y una combinación más antigua, esa pasa a Pago recibido', () => {
    const owed = [pending(2, '2026-10', 1_000_000), pending(1, '2026-09', 1_000_000)];
    expect(decide({ owedInvoices: owed, receipts: [receipt(CUIT, '10000')] })).toEqual({
      rule: 'RF-135',
      action: 'pago_recibido',
      invoiceIds: [1],
    });
  });

  it('AC-141, RF-136: sin combinación más antigua, "no se pudo determinar qué facturas cancela el pago"', () => {
    const owed = [pending(1, '2026-10', 1_000_000), pending(2, '2026-10', 1_000_000)];
    expect(decide({ owedInvoices: owed, receipts: [receipt(CUIT, '10000')] })).toEqual({
      rule: 'RF-136',
      action: 'revision_manual',
      reason: 'no se pudo determinar qué facturas cancela el pago',
      invoiceIds: [1, 2],
    });
  });

  it('AC-143, RF-137: validable sin coincidencias (un pago parcial), "monto no coincide"', () => {
    expect(decide({ owedInvoices: ONE_DEBT, receipts: [receipt(CUIT, '5000')] })).toEqual({
      rule: 'RF-137',
      action: 'revision_manual',
      reason: 'monto no coincide',
      invoiceIds: [1],
    });
  });

  it('AC-230, AC-231, RNF-13: un centavo de más, un monto de cero o con fracción de centavo es "monto no coincide"', () => {
    const owed = [pending(1, '2026-10', 1_500_000)];
    for (const amount of ['15000.01', '0', '15000.005']) {
      expect(decide({ owedInvoices: owed, receipts: [receipt(CUIT, amount)] }), amount).toMatchObject({
        rule: 'RF-137',
        reason: 'monto no coincide',
      });
    }
  });

  it('AC-137: con varios comprobantes, se buscan las coincidencias por comprobante', () => {
    const owed = [pending(1, '2026-01', 10_000), pending(2, '2026-02', 20_000), pending(3, '2026-03', 30_000)];
    expect(decide({ owedInvoices: owed, receipts: [receipt(CUIT, '100'), receipt(CUIT, '200')] })).toEqual({
      rule: 'RF-134',
      action: 'pago_recibido',
      invoiceIds: [1, 2],
    });
  });
});

describe('las reglas son excluyentes', () => {
  it('cualquier combinación de clasificación, deuda y revisión recibe exactamente una regla', () => {
    const debts: Array<[string, OwedInvoiceState[]]> = [
      ['sin deuda', []],
      ['con deuda', ONE_DEBT],
      ['en revisión', [inReview(1, '2026-10', 1_000_000)]],
    ];
    for (const classification of ['si', 'no', 'dudoso', 'error'] as const) {
      for (const [label, owedInvoices] of debts) {
        const decision = decide({ classification, owedInvoices, receipts: [receipt(CUIT, '10000')] });
        expect(decision.rule, `${classification}, ${label}`).toMatch(/^RF-1(2[6-9]|3[0-7])$/);
      }
    }
  });
});
