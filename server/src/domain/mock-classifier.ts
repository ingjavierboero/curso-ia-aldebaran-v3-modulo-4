import type { ClassificationResult } from '../adapters/types.ts';

/** `pago_<CUIT>_<monto>.<extensión>`; el monto puede tener punto decimal (RF-189). */
const PAYMENT_FILENAME = /^pago_([^_]+)_([^_]+)\.[^.]+$/;

/**
 * Clasificación del modo mock según el nombre del archivo, sin distinguir mayúsculas (RF-188 a
 * RF-193). Devuelve el CUIT y el monto tal cual: los valida después la misma lógica que al LLM real.
 */
export function classifyByFilename(filename: string): ClassificationResult {
  const name = filename.trim().toLowerCase();
  if (name.startsWith('dudoso')) return { kind: 'dudoso' };
  if (name.startsWith('error')) return { kind: 'error', message: 'procesamiento simulado como erróneo (modo mock)' };

  const match = PAYMENT_FILENAME.exec(name);
  if (!match) return { kind: 'no' };

  // Una "x" en lugar del CUIT o del monto es un dato que no se pudo extraer (RF-190).
  const [, cuit = 'x', amount = 'x'] = match;
  return { kind: 'si', cuit: cuit === 'x' ? null : cuit, amountRaw: amount === 'x' ? null : amount };
}
