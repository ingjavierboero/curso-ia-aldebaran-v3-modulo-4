import { describe, expect, it } from 'vitest';
import { invoiceDates } from '../../../src/domain/billing-dates.ts';

/** Instante a partir de una hora de Argentina (UTC-3, sin horario de verano). */
const argentina = (date: string, time = '11:00') => new Date(`${date}T${time}:00-03:00`);

describe('fechas de la factura (RF-79 a RF-81)', () => {
  it('AC-75: en el proceso del 15/10/2026 la factura de octubre se emite el 15/10, cubre el mes y vence el 31/10', () => {
    expect(invoiceDates('2026-10', argentina('2026-10-15'))).toEqual({
      issueDate: '2026-10-15',
      serviceFrom: '2026-10-01',
      serviceTo: '2026-10-31',
      dueDate: '2026-10-31',
    });
  });

  it('AC-76: en un reintento manual del 03/11/2026 la factura de octubre se emite y vence el 03/11', () => {
    expect(invoiceDates('2026-10', argentina('2026-11-03', '09:30'))).toEqual({
      issueDate: '2026-11-03',
      serviceFrom: '2026-10-01',
      serviceTo: '2026-10-31',
      dueDate: '2026-11-03',
    });
  });

  it('RF-81: generada el último día del mes, vence ese mismo día', () => {
    const dates = invoiceDates('2026-10', argentina('2026-10-31', '23:59'));
    expect(dates.issueDate).toBe('2026-10-31');
    expect(dates.dueDate).toBe('2026-10-31');
  });

  it('RNF-12: la fecha de emisión es la de Argentina, no la de UTC', () => {
    // 02:00 UTC del 01/11 son las 23:00 del 31/10 en Argentina.
    const lastNight = invoiceDates('2026-10', new Date('2026-11-01T02:00:00Z'));
    expect(lastNight.issueDate).toBe('2026-10-31');
    expect(lastNight.dueDate).toBe('2026-10-31');
    // 01:00 UTC del 15/10 son las 22:00 del 14/10 en Argentina.
    expect(invoiceDates('2026-10', new Date('2026-10-15T01:00:00Z')).issueDate).toBe('2026-10-14');
  });

  it('RF-80: el período de servicio termina el último día del mes, también en febrero de un año bisiesto', () => {
    expect(invoiceDates('2028-02', argentina('2028-02-15'))).toMatchObject({
      serviceFrom: '2028-02-01',
      serviceTo: '2028-02-29',
      dueDate: '2028-02-29',
    });
    expect(invoiceDates('2027-02', argentina('2027-02-15')).serviceTo).toBe('2027-02-28');
  });

  it('RF-81: un reintento de diciembre en enero del año siguiente vence el día del reintento', () => {
    expect(invoiceDates('2026-12', argentina('2027-01-05'))).toEqual({
      issueDate: '2027-01-05',
      serviceFrom: '2026-12-01',
      serviceTo: '2026-12-31',
      dueDate: '2027-01-05',
    });
  });
});
