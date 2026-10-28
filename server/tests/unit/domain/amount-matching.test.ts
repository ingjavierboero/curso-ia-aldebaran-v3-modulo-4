import { describe, expect, it } from 'vitest';
import { findAmountMatches, type OwedInvoice, pickMatch } from '../../../src/domain/amount-matching.ts';

/** Factura adeudada: id, período y total en centavos. */
const inv = (id: number, period: string, totalCents: number): OwedInvoice => ({ id, period, totalCents });

/** Coincidencias como listas de ids, en el orden en que llegan (cada una, de la más antigua a la más reciente). */
const ids = (matches: OwedInvoice[][]) => matches.map((match) => match.map((invoice) => invoice.id));

describe('coincidencias de monto con un comprobante (PRD, Definiciones)', () => {
  it('AC-133: una factura cuyo total es igual al monto', () => {
    const invoices = [inv(1, '2026-10', 1_500_000)];
    expect(ids(findAmountMatches(invoices, [1_500_000]))).toEqual([[1]]);
  });

  it('AC-134: la única combinación que suma el monto (A + C)', () => {
    const a = inv(1, '2026-08', 100_000);
    const b = inv(2, '2026-09', 250_000);
    const c = inv(3, '2026-10', 400_000);
    expect(ids(findAmountMatches([a, b, c], [500_000]))).toEqual([[1, 3]]);
  });

  it('AC-135: la suma de todas las facturas', () => {
    const invoices = [inv(1, '2026-08', 100_000), inv(2, '2026-09', 250_000), inv(3, '2026-10', 400_001)];
    expect(ids(findAmountMatches(invoices, [750_001]))).toEqual([[1, 2, 3]]);
  });

  it('cada coincidencia lista sus facturas de la más antigua a la más reciente', () => {
    const invoices = [inv(7, '2026-10', 300), inv(3, '2026-08', 100)];
    expect(ids(findAmountMatches(invoices, [400]))).toEqual([[3, 7]]);
  });

  it('AC-139: dos facturas del mismo monto son dos coincidencias distintas', () => {
    const invoices = [inv(1, '2026-09', 1_000_000), inv(2, '2026-10', 1_000_000)];
    expect(findAmountMatches(invoices, [1_000_000])).toHaveLength(2);
  });

  it('AC-230: un centavo de diferencia no es coincidencia', () => {
    expect(findAmountMatches([inv(1, '2026-10', 1_500_000)], [1_500_001])).toEqual([]);
  });

  it('AC-231, RNF-13: un monto de cero o negativo no tiene ninguna coincidencia', () => {
    const invoices = [inv(1, '2026-10', 1_000_000)];
    expect(findAmountMatches(invoices, [0])).toEqual([]);
    expect(findAmountMatches(invoices, [-1_000_000])).toEqual([]);
  });

  it('sin facturas adeudadas no hay coincidencias', () => {
    expect(findAmountMatches([], [1_000_000])).toEqual([]);
  });
});

describe('coincidencias de monto con varios comprobantes (PRD, Definiciones)', () => {
  it('AC-137: coincidencia por comprobante (A por $100 y B por $200), aunque la suma coincida con C', () => {
    const a = inv(1, '2026-01', 10_000);
    const b = inv(2, '2026-02', 20_000);
    const c = inv(3, '2026-03', 30_000);
    expect(ids(findAmountMatches([a, b, c], [10_000, 20_000]))).toEqual([[1, 2]]);
  });

  it('AC-138: sin coincidencia por comprobante, coincidencia por suma (A de $300 con comprobantes de $100 y $200)', () => {
    const a = inv(1, '2026-01', 30_000);
    expect(ids(findAmountMatches([a], [10_000, 20_000]))).toEqual([[1]]);
  });

  it('a cada comprobante le corresponde al menos una factura distinta', () => {
    // Una sola factura de $100 no se puede repartir entre dos comprobantes de $100.
    const invoices = [inv(1, '2026-01', 10_000)];
    expect(findAmountMatches(invoices, [10_000, 10_000])).toEqual([]);
  });

  it('dos repartos con el mismo conjunto de facturas son una sola coincidencia', () => {
    // A y B de $100 con dos comprobantes de $100: A→1, B→2 y A→2, B→1 usan el mismo conjunto.
    const invoices = [inv(1, '2026-01', 10_000), inv(2, '2026-02', 10_000)];
    expect(ids(findAmountMatches(invoices, [10_000, 10_000]))).toEqual([[1, 2]]);
  });

  it('un comprobante puede cubrir varias facturas', () => {
    const invoices = [inv(1, '2026-01', 10_000), inv(2, '2026-02', 5_000), inv(3, '2026-03', 5_000)];
    expect(ids(findAmountMatches(invoices, [10_000, 10_000]))).toEqual([[1, 2, 3]]);
  });

  it('un monto de cero en cualquiera de los comprobantes deja al email sin coincidencias (RNF-13)', () => {
    const invoices = [inv(1, '2026-01', 10_000), inv(2, '2026-02', 20_000)];
    expect(findAmountMatches(invoices, [10_000, 0])).toEqual([]);
  });
});

describe('elección de la coincidencia (RF-134 a RF-137)', () => {
  it('RF-134: con una única coincidencia, esa', () => {
    const invoices = [inv(1, '2026-10', 1_000_000)];
    expect(pickMatch(findAmountMatches(invoices, [1_000_000]))).toEqual({ status: 'unique', invoiceIds: [1] });
  });

  it('RF-137: sin coincidencias, ninguna', () => {
    expect(pickMatch([])).toEqual({ status: 'none' });
  });

  it('AC-139: entre dos facturas del mismo monto, la combinación más antigua es la de la factura más antigua', () => {
    const invoices = [inv(2, '2026-10', 1_000_000), inv(1, '2026-09', 1_000_000)];
    expect(pickMatch(findAmountMatches(invoices, [1_000_000]))).toEqual({ status: 'oldest', invoiceIds: [1] });
  });

  it('AC-140: enero + abril gana sobre febrero + marzo', () => {
    const invoices = [
      inv(1, '2026-01', 10_000),
      inv(2, '2026-02', 20_000),
      inv(3, '2026-03', 30_000),
      inv(4, '2026-04', 40_000),
    ];
    expect(pickMatch(findAmountMatches(invoices, [50_000]))).toEqual({ status: 'oldest', invoiceIds: [1, 4] });
  });

  it('a igual factura más antigua, se compara la siguiente', () => {
    // {ene, mar} y {ene, abr}: empatan en enero y gana la que sigue con marzo.
    const invoices = [inv(1, '2026-01', 10_000), inv(3, '2026-03', 20_000), inv(4, '2026-04', 20_000)];
    expect(pickMatch(findAmountMatches(invoices, [30_000]))).toEqual({ status: 'oldest', invoiceIds: [1, 3] });
  });

  it('AC-141: dos facturas del mismo período y el mismo monto: no hay combinación más antigua', () => {
    const invoices = [inv(1, '2026-10', 1_000_000), inv(2, '2026-10', 1_000_000)];
    expect(pickMatch(findAmountMatches(invoices, [1_000_000]))).toEqual({ status: 'ambiguous' });
  });

  it('AC-142: A de enero por $300 se queda sin facturas mientras B (enero) + C (febrero) sigue: no hay combinación más antigua', () => {
    const invoices = [inv(1, '2026-01', 30_000), inv(2, '2026-01', 10_000), inv(3, '2026-02', 20_000)];
    expect(pickMatch(findAmountMatches(invoices, [30_000]))).toEqual({ status: 'ambiguous' });
  });
});
