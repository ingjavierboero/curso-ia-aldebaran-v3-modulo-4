import { describe, expect, it } from 'vitest';
import {
  addDays,
  argentinaParts,
  civilDate,
  currentPeriod,
  isAtOrAfterTime,
  isLastDayOfMonth,
  lastDayOfMonth,
} from '../../../src/domain/billing-dates.ts';
import { ar } from '../../helpers/time.ts';

// Los instantes se escriben en UTC explícito: el resultado no depende de la zona horaria del proceso.

describe('fecha y hora civil de Argentina (RNF-12)', () => {
  it('AC-229: con el reloj del servidor en UTC, las 14:00 UTC del 15 son las 11:00 del 15 en Argentina', () => {
    expect(argentinaParts(new Date('2026-10-15T14:00:00Z'))).toEqual({
      year: 2026,
      month: 10,
      day: 15,
      hour: 11,
      minute: 0,
    });
  });

  it('AC-229: las 11:00 UTC del 15 son las 08:00 en Argentina, antes de la hora de facturación por defecto', () => {
    expect(isAtOrAfterTime(new Date('2026-10-15T11:00:00Z'), '11:00')).toBe(false);
    expect(isAtOrAfterTime(new Date('2026-10-15T14:00:00Z'), '11:00')).toBe(true);
  });

  it('el día se toma en Argentina, no en UTC: las 02:30 UTC del 1/11 son el 31/10 a las 23:30', () => {
    const instant = new Date('2026-11-01T02:30:00Z');
    expect(civilDate(instant)).toBe('2026-10-31');
    expect(currentPeriod(instant)).toBe('2026-10');
    expect(isLastDayOfMonth(instant)).toBe(true);
  });

  it('la medianoche de Argentina ya pertenece al día siguiente', () => {
    expect(civilDate(ar('2026-11-01T00:00'))).toBe('2026-11-01');
    expect(argentinaParts(ar('2026-11-01T00:00')).hour).toBe(0);
  });
});

describe('período, último día del mes y suma de días', () => {
  it('el período del mes en curso tiene formato YYYY-MM', () => {
    expect(currentPeriod(ar('2026-01-05T09:00'))).toBe('2026-01');
    expect(currentPeriod(ar('2026-12-31T23:59'))).toBe('2026-12');
  });

  it('calcula el último día de cada mes, incluidos los años bisiestos', () => {
    expect(lastDayOfMonth(2026, 10)).toBe('2026-10-31');
    expect(lastDayOfMonth(2026, 9)).toBe('2026-09-30');
    expect(lastDayOfMonth(2026, 2)).toBe('2026-02-28');
    expect(lastDayOfMonth(2028, 2)).toBe('2028-02-29');
    expect(lastDayOfMonth(2026, 12)).toBe('2026-12-31');
  });

  it('identifica el último día del mes en Argentina', () => {
    expect(isLastDayOfMonth(ar('2026-10-31T11:00'))).toBe(true);
    expect(isLastDayOfMonth(ar('2026-10-30T11:00'))).toBe(false);
    expect(isLastDayOfMonth(ar('2026-02-28T11:00'))).toBe(true);
  });

  it('suma días a una fecha civil, cruzando meses y años', () => {
    expect(addDays('2026-10-25', 10)).toBe('2026-11-04');
    expect(addDays('2026-12-28', 10)).toBe('2027-01-07');
    expect(addDays('2028-02-25', 4)).toBe('2028-02-29');
  });
});

describe('comparación con la hora configurada (RF-51, RF-149)', () => {
  it('es al minuto: 10:59 todavía no es la hora y 11:00 sí', () => {
    expect(isAtOrAfterTime(ar('2026-10-15T10:59'), '11:00')).toBe(false);
    expect(isAtOrAfterTime(ar('2026-10-15T11:00'), '11:00')).toBe(true);
    expect(isAtOrAfterTime(ar('2026-10-15T11:01'), '11:00')).toBe(true);
  });

  it('funciona en los extremos 00:00 y 23:59', () => {
    expect(isAtOrAfterTime(ar('2026-10-15T00:00'), '00:00')).toBe(true);
    expect(isAtOrAfterTime(ar('2026-10-15T23:58'), '23:59')).toBe(false);
    expect(isAtOrAfterTime(ar('2026-10-15T23:59'), '23:59')).toBe(true);
  });
});
