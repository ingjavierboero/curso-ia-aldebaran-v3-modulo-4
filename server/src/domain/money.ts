/** Montos en centavos enteros (RNF-13, research R-02). */

/**
 * Monto extraído de un comprobante:
 * - `ok`: monto válido en centavos.
 * - `invalid`: se extrajo, pero es ≤ 0 o tiene fracción de centavo; el email no tiene coincidencias (RNF-13).
 * - `missing`: no se pudo extraer (RF-132).
 */
export type ExtractedAmount = { status: 'ok'; cents: number } | { status: 'invalid' } | { status: 'missing' };

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

export function parseExtractedAmount(raw: string | null | undefined): ExtractedAmount {
  let text = raw?.trim() ?? '';
  if (!text) return { status: 'missing' };
  // Acepta la coma como separador decimal cuando no hay punto.
  if (!text.includes('.')) text = text.replace(',', '.');

  const match = DECIMAL.exec(text);
  if (!match) return { status: 'missing' };

  const [, sign, integer = '0', fraction = ''] = match;
  // Los ceros finales no son fracción de centavo: "15000.500" son 15000,50.
  const significant = fraction.replace(/0+$/, '');
  if (significant.length > 2) return { status: 'invalid' };

  const cents = Number(integer) * 100 + Number(significant.padEnd(2, '0'));
  if (sign === '-' || cents <= 0) return { status: 'invalid' };
  return { status: 'ok', cents };
}

/**
 * RF-64: convierte una cuota en dólares a pesos con la cotización, redondeando al centavo más
 * cercano. Usa BigInt porque el producto de dos montos puede superar el entero exacto de JavaScript.
 */
export function usdToArsCents(usdCents: number, rateCents: number): number {
  const product = BigInt(usdCents) * BigInt(rateCents); // en centésimos de centavo de peso
  const cents = product / 100n;
  return Number(product % 100n >= 50n ? cents + 1n : cents);
}
