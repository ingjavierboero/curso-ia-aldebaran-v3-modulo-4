import { describe, expect, it } from 'vitest';
import { classifyByFilename } from '../../../src/domain/mock-classifier.ts';

describe('clasificador del modo mock por nombre de archivo (RF-188 a RF-193)', () => {
  it('AC-197, RF-189: pago_<CUIT>_<monto>.<extensión> es "si" con ese CUIT y ese monto', () => {
    expect(classifyByFilename('pago_30711111111_15000.50.pdf')).toEqual({
      kind: 'si',
      cuit: '30711111111',
      amountRaw: '15000.50',
    });
    expect(classifyByFilename('pago_30711111111_300.png')).toEqual({ kind: 'si', cuit: '30711111111', amountRaw: '300' });
  });

  it('RF-188: no distingue mayúsculas de minúsculas', () => {
    expect(classifyByFilename('PAGO_30711111111_300.PNG')).toEqual({ kind: 'si', cuit: '30711111111', amountRaw: '300' });
    expect(classifyByFilename('Pago_30711111111_300.Jpg')).toEqual({ kind: 'si', cuit: '30711111111', amountRaw: '300' });
  });

  it('AC-198, RF-190: una x en lugar del CUIT o del monto es un dato que no se pudo extraer', () => {
    expect(classifyByFilename('PAGO_x_15000.50.PDF')).toEqual({ kind: 'si', cuit: null, amountRaw: '15000.50' });
    expect(classifyByFilename('pago_30711111111_x.png')).toEqual({ kind: 'si', cuit: '30711111111', amountRaw: null });
    expect(classifyByFilename('pago_X_X.pdf')).toEqual({ kind: 'si', cuit: null, amountRaw: null });
  });

  it('el CUIT y el monto se devuelven tal cual: su validación es responsabilidad de las reglas de pago', () => {
    expect(classifyByFilename('pago_3071111111_100.pdf')).toEqual({ kind: 'si', cuit: '3071111111', amountRaw: '100' });
    expect(classifyByFilename('pago_30711111111_0.pdf')).toEqual({ kind: 'si', cuit: '30711111111', amountRaw: '0' });
  });

  it('AC-199, RF-191: un adjunto cuyo nombre empieza con "dudoso" es "dudoso"', () => {
    expect(classifyByFilename('dudoso_transferencia.jpg')).toEqual({ kind: 'dudoso' });
    expect(classifyByFilename('DUDOSO.pdf')).toEqual({ kind: 'dudoso' });
    expect(classifyByFilename('dudoso_1.pdf')).toEqual({ kind: 'dudoso' });
  });

  it('AC-199, RF-192: un adjunto cuyo nombre empieza con "error" tiene el procesamiento marcado como erróneo', () => {
    expect(classifyByFilename('error_1.pdf')).toMatchObject({ kind: 'error' });
    expect(classifyByFilename('Error.PNG')).toMatchObject({ kind: 'error' });
  });

  it('AC-199, RF-193: cualquier otro nombre es "no"', () => {
    expect(classifyByFilename('factura_proveedor.pdf')).toEqual({ kind: 'no' });
    expect(classifyByFilename('pago.pdf')).toEqual({ kind: 'no' });
    expect(classifyByFilename('pago_30711111111.pdf')).toEqual({ kind: 'no' });
    expect(classifyByFilename('mi_dudoso.pdf')).toEqual({ kind: 'no' });
    expect(classifyByFilename('comprobante_error.pdf')).toEqual({ kind: 'no' });
  });
});
