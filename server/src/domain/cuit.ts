/** Pesos del dígito verificador del CUIT (algoritmo módulo 11 de ARCA). */
const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/** RF-125: deja solo los dígitos, sin guiones, puntos ni espacios. */
export function normalizeCuit(raw: string): string {
  return raw.replace(/\D/g, '');
}

/** RF-39: el CUIT (ya normalizado) tiene 11 dígitos y un dígito verificador válido. */
export function isValidCuit(cuit: string): boolean {
  if (!/^\d{11}$/.test(cuit)) return false;
  const digits = [...cuit].map(Number);
  const sum = WEIGHTS.reduce((acc, weight, i) => acc + weight * (digits[i] ?? 0), 0);
  const remainder = 11 - (sum % 11);
  const check = remainder === 11 ? 0 : remainder;
  // Un resultado de 10 no corresponde a ningún dígito: el CUIT es inválido.
  return check !== 10 && check === digits[10];
}

/** RF-125: compara dos CUIT solo por sus dígitos. */
export function cuitsMatch(a: string, b: string): boolean {
  return normalizeCuit(a) === normalizeCuit(b);
}

/**
 * RF-122: el CUIT extraído de un comprobante solo cuenta si tiene 11 dígitos; si no, se considera
 * no extraído. No se valida el dígito verificador: el CUIT solo se compara con el del cliente.
 */
export function parseExtractedCuit(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = normalizeCuit(raw);
  return digits.length === 11 ? digits : null;
}
