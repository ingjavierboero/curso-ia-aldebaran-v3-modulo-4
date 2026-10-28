import { describe, expect, it } from 'vitest';
import { formatCuit, formatDate, formatDateTime, formatMoney, formatPeriod } from '../src/format.ts';

describe('formato de datos en pantalla (plan.md, Diseño de la interfaz)', () => {
  it('el CUIT se muestra con guiones', () => {
    expect(formatCuit('20111111112')).toBe('20-11111111-2');
    expect(formatCuit('30711111111')).toBe('30-71111111-1');
  });

  it('un valor que no tiene 11 dígitos se muestra tal cual', () => {
    expect(formatCuit('2011111111')).toBe('2011111111');
    expect(formatCuit('')).toBe('');
  });
});

describe('montos y fechas', () => {
  it('los montos se muestran con el símbolo de la moneda y separadores de Argentina', () => {
    expect(formatMoney(1_500_000, 'ARS').replace(/\s/g, ' ')).toBe('$ 15.000,00');
    expect(formatMoney(12_050, 'USD').replace(/\s/g, ' ')).toBe('US$ 120,50');
    expect(formatMoney(1, 'ARS').replace(/\s/g, ' ')).toBe('$ 0,01');
  });

  it('las fechas se muestran como DD/MM/AAAA, en la hora de Argentina', () => {
    expect(formatDate('2026-10-20T12:00:00Z')).toBe('20/10/2026');
    // 01:00 UTC del 21 todavía es el 20 en Argentina (UTC-3).
    expect(formatDate('2026-10-21T01:00:00Z')).toBe('20/10/2026');
    expect(formatDate('2024-02-29')).toBe('29/02/2024');
  });
});

describe('períodos', () => {
  it('el período se muestra con el nombre del mes', () => {
    expect(formatPeriod('2026-10')).toBe('Octubre 2026');
    expect(formatPeriod('2027-01')).toBe('Enero 2027');
  });
});

describe('fecha y hora', () => {
  it('se muestran como DD/MM/AAAA HH:mm en la hora de Argentina', () => {
    expect(formatDateTime('2026-10-20T13:05:00.000Z')).toBe('20/10/2026 10:05');
    expect(formatDateTime('2026-10-21T01:00:00.000Z')).toBe('20/10/2026 22:00');
  });
});
