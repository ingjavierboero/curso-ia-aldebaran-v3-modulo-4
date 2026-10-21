import { describe, expect, it } from 'vitest';
import { parseExtractedAmount, usdToArsCents } from '../../../src/domain/money.ts';

describe('parseExtractedAmount: montos de comprobantes en centavos (RNF-13)', () => {
  it('convierte montos decimales a centavos exactos, sin redondeos', () => {
    expect(parseExtractedAmount('15000.50')).toEqual({ status: 'ok', cents: 1_500_050 });
    expect(parseExtractedAmount('15000')).toEqual({ status: 'ok', cents: 1_500_000 });
    expect(parseExtractedAmount('15000.5')).toEqual({ status: 'ok', cents: 1_500_050 });
    expect(parseExtractedAmount('0.01')).toEqual({ status: 'ok', cents: 1 });
    expect(parseExtractedAmount(' 216600.00 ')).toEqual({ status: 'ok', cents: 21_660_000 });
  });

  it('acepta la coma como separador decimal', () => {
    expect(parseExtractedAmount('15000,50')).toEqual({ status: 'ok', cents: 1_500_050 });
  });

  it('los ceros finales no son fracción de centavo', () => {
    expect(parseExtractedAmount('15000.500')).toEqual({ status: 'ok', cents: 1_500_050 });
  });

  it('AC-230: distingue un centavo de diferencia', () => {
    expect(parseExtractedAmount('15000.01')).toEqual({ status: 'ok', cents: 1_500_001 });
  });

  it('AC-231, RNF-13: un monto igual o menor a cero es inválido y el email no tiene coincidencias', () => {
    expect(parseExtractedAmount('0')).toEqual({ status: 'invalid' });
    expect(parseExtractedAmount('0.00')).toEqual({ status: 'invalid' });
    expect(parseExtractedAmount('-10')).toEqual({ status: 'invalid' });
  });

  it('RNF-13: un monto con fracción de centavo es inválido', () => {
    expect(parseExtractedAmount('10.005')).toEqual({ status: 'invalid' });
    expect(parseExtractedAmount('15000.555')).toEqual({ status: 'invalid' });
  });

  it('RF-132: un monto ausente o ilegible se considera no extraído', () => {
    expect(parseExtractedAmount(null)).toEqual({ status: 'missing' });
    expect(parseExtractedAmount(undefined)).toEqual({ status: 'missing' });
    expect(parseExtractedAmount('')).toEqual({ status: 'missing' });
    expect(parseExtractedAmount('x')).toEqual({ status: 'missing' });
    expect(parseExtractedAmount('quince mil')).toEqual({ status: 'missing' });
    expect(parseExtractedAmount('$ 15.000,50')).toEqual({ status: 'missing' });
  });
});

describe('usdToArsCents: conversión de cuotas en dólares (RF-64)', () => {
  it('AC-64: USD 0,01 con una cotización de $1.555,50 se factura $15,56 ($15,555 redondeado)', () => {
    expect(usdToArsCents(1, 155_550)).toBe(1_556);
  });

  it('redondea al centavo más cercano hacia abajo cuando corresponde', () => {
    expect(usdToArsCents(1, 155_540)).toBe(1_555); // $15,554
    expect(usdToArsCents(1, 155_549)).toBe(1_555); // $15,5549
  });

  it('AC-63: USD 100 con una cotización de $1.500 son $150.000', () => {
    expect(usdToArsCents(10_000, 150_000)).toBe(15_000_000);
  });

  it('mantiene la precisión con montos grandes', () => {
    expect(usdToArsCents(999_999_99, 999_999_99)).toBe(99_999_998_000_000);
  });
});
