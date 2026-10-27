import { describe, expect, it } from 'vitest';
import { cuitsMatch, isValidCuit, normalizeCuit, parseExtractedCuit } from '../../../src/domain/cuit.ts';

describe('isValidCuit: dígito verificador (RF-39)', () => {
  it('AC-41: 30711111118 tiene el dígito verificador incorrecto y 30711111111 es válido', () => {
    expect(isValidCuit('30711111118')).toBe(false);
    expect(isValidCuit('30711111111')).toBe(true);
  });

  it('acepta CUIT válidos de personas y empresas', () => {
    expect(isValidCuit('20111111112')).toBe(true); // CUIT emisor del modo mock (RF-206)
    expect(isValidCuit('27123456780')).toBe(true);
    expect(isValidCuit('30500010912')).toBe(true);
  });

  it('rechaza un dígito verificador incorrecto en cualquier CUIT', () => {
    expect(isValidCuit('20111111111')).toBe(false);
    expect(isValidCuit('27123456781')).toBe(false);
  });

  it('rechaza longitudes distintas de 11 y caracteres no numéricos (se valida ya normalizado)', () => {
    expect(isValidCuit('3071111111')).toBe(false);
    expect(isValidCuit('307111111111')).toBe(false);
    expect(isValidCuit('30-71111111-1')).toBe(false);
    expect(isValidCuit('')).toBe(false);
  });
});

describe('normalizeCuit y cuitsMatch (RF-125)', () => {
  it('deja solo los dígitos, sin guiones, puntos ni espacios', () => {
    expect(normalizeCuit('30-71111111-8')).toBe('30711111118');
    expect(normalizeCuit(' 30.711.111.118 ')).toBe('30711111118');
    expect(normalizeCuit('30 71111111 8')).toBe('30711111118');
  });

  it('AC-132: el CUIT 30-71111111-1 del comprobante coincide con el 30711111111 del cliente', () => {
    expect(cuitsMatch('30-71111111-1', '30711111111')).toBe(true);
  });

  it('AC-130: un CUIT distinto no coincide', () => {
    expect(cuitsMatch('30-71111111-8', '30711111111')).toBe(false);
  });
});

describe('parseExtractedCuit: CUIT extraído de un comprobante (RF-122)', () => {
  it('devuelve el CUIT normalizado cuando tiene 11 dígitos', () => {
    expect(parseExtractedCuit('30-71111111-8')).toBe('30711111118');
    expect(parseExtractedCuit('30711111118')).toBe('30711111118');
  });

  it('AC-114: un CUIT de menos o más de 11 dígitos se considera no extraído', () => {
    expect(parseExtractedCuit('30-7111111-8')).toBeNull();
    expect(parseExtractedCuit('3071111111811')).toBeNull();
  });

  it('un CUIT ausente o ilegible se considera no extraído (RF-132)', () => {
    expect(parseExtractedCuit(null)).toBeNull();
    expect(parseExtractedCuit(undefined)).toBeNull();
    expect(parseExtractedCuit('')).toBeNull();
    expect(parseExtractedCuit('x')).toBeNull();
  });

  it('no valida el dígito verificador: el CUIT extraído solo se compara con el del cliente', () => {
    expect(parseExtractedCuit('30711111118')).toBe('30711111118');
  });
});
