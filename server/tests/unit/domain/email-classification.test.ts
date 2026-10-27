import { describe, expect, it } from 'vitest';
import { classifyEmail } from '../../../src/domain/email-classification.ts';

describe('clasificación del email a partir de sus adjuntos (RF-123)', () => {
  it('AC-113: con adjuntos "si", "si" y "no", el email es "si"', () => {
    expect(classifyEmail(['si', 'si', 'no'])).toBe('si');
  });

  it('AC-127: un adjunto "dudoso" gana sobre un "si"', () => {
    expect(classifyEmail(['si', 'dudoso'])).toBe('dudoso');
  });

  it('AC-136: un adjunto "si" gana sobre un "no", en cualquier orden', () => {
    expect(classifyEmail(['no', 'si'])).toBe('si');
    expect(classifyEmail(['si', 'no'])).toBe('si');
  });

  it('RF-123: si el procesamiento de al menos un adjunto fue erróneo, el email es erróneo, aunque haya "si" o "dudoso"', () => {
    expect(classifyEmail(['si', 'error'])).toBe('error');
    expect(classifyEmail(['dudoso', 'error', 'no'])).toBe('error');
  });

  it('RF-123: si todos los adjuntos son "no", el email es "no"', () => {
    expect(classifyEmail(['no'])).toBe('no');
    expect(classifyEmail(['no', 'no'])).toBe('no');
  });

  it('un único adjunto define la clasificación del email', () => {
    for (const kind of ['si', 'no', 'dudoso', 'error'] as const) expect(classifyEmail([kind]), kind).toBe(kind);
  });

  it('RF-115: un email sin adjuntos no tiene clasificación', () => {
    expect(classifyEmail([])).toBeNull();
  });
});
