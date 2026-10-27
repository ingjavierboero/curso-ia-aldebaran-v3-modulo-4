import { describe, expect, it } from 'vitest';
import { formatCuit } from '../src/format.ts';

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
