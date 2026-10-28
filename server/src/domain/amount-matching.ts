/** Coincidencias de monto y combinación más antigua (PRD, Definiciones; research R-09). */

/** Factura adeudada, con su período `YYYY-MM` para medir su antigüedad. */
export interface OwedInvoice {
  id: number;
  period: string;
  totalCents: number;
}

/** De la más antigua a la más reciente; a igual período, por id para que el orden sea estable. */
const byAge = (a: OwedInvoice, b: OwedInvoice) => a.period.localeCompare(b.period) || a.id - b.id;

/**
 * Todos los subconjuntos no vacíos de `invoices` (ya ordenadas por antigüedad) cuyo total es exactamente
 * `target`. Como los totales son positivos, se poda en cuanto la suma parcial se pasa del objetivo.
 */
function subsetsSumming(invoices: OwedInvoice[], target: number): OwedInvoice[][] {
  const found: OwedInvoice[][] = [];
  const chosen: OwedInvoice[] = [];
  const walk = (start: number, remaining: number) => {
    if (remaining === 0 && chosen.length > 0) {
      found.push([...chosen]);
      return;
    }
    for (let i = start; i < invoices.length; i += 1) {
      const invoice = invoices[i] as OwedInvoice;
      if (invoice.totalCents > remaining) continue;
      chosen.push(invoice);
      walk(i + 1, remaining - invoice.totalCents);
      chosen.pop();
    }
  };
  walk(0, target);
  return found;
}

/**
 * Coincidencias por comprobante: repartos de facturas entre los comprobantes donde cada uno recibe al
 * menos una factura distinta y suma exactamente su monto. Dos repartos con el mismo conjunto de facturas
 * son una sola coincidencia.
 */
function perReceiptMatches(invoices: OwedInvoice[], amounts: number[]): OwedInvoice[][] {
  const matches = new Map<string, OwedInvoice[]>();
  const walk = (receipt: number, available: OwedInvoice[], used: OwedInvoice[]) => {
    if (receipt === amounts.length) {
      const match = [...used].sort(byAge);
      matches.set(match.map((invoice) => invoice.id).join(','), match);
      return;
    }
    for (const subset of subsetsSumming(available, amounts[receipt] as number)) {
      const rest = available.filter((invoice) => !subset.includes(invoice));
      walk(receipt + 1, rest, [...used, ...subset]);
    }
  };
  walk(0, invoices, []);
  return [...matches.values()];
}

/**
 * Coincidencias de monto de un email (PRD, Definiciones). Con un comprobante, las facturas o combinaciones
 * cuyo total es su monto. Con varios, las coincidencias por comprobante y, si no hay ninguna, las
 * coincidencias por suma con el total de los comprobantes. Un monto de cero o negativo deja al email sin
 * coincidencias (RNF-13). Cada coincidencia lista sus facturas de la más antigua a la más reciente.
 */
export function findAmountMatches(invoices: OwedInvoice[], amounts: number[]): OwedInvoice[][] {
  if (amounts.length === 0 || amounts.some((amount) => amount <= 0) || invoices.length === 0) return [];
  const sorted = [...invoices].sort(byAge);
  if (amounts.length === 1) return subsetsSumming(sorted, amounts[0] as number);

  const perReceipt = perReceiptMatches(sorted, amounts);
  if (perReceipt.length > 0) return perReceipt;
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  return subsetsSumming(sorted, total);
}

export type MatchDecision =
  | { status: 'unique'; invoiceIds: number[] }
  | { status: 'oldest'; invoiceIds: number[] }
  | { status: 'ambiguous' }
  | { status: 'none' };

/**
 * Elige la coincidencia (RF-134 a RF-137): la única, o entre varias la combinación más antigua. Se compara
 * posición a posición la factura más antigua de cada una (a igual período empatan); la comparación
 * termina cuando alguna se queda sin facturas, y si no queda una sola, no hay combinación más antigua.
 */
export function pickMatch(matches: OwedInvoice[][]): MatchDecision {
  if (matches.length === 0) return { status: 'none' };
  if (matches.length === 1) return { status: 'unique', invoiceIds: (matches[0] ?? []).map((invoice) => invoice.id) };

  let candidates = matches;
  for (let position = 0; candidates.every((match) => match.length > position); position += 1) {
    const oldest = candidates.map((match) => (match[position] as OwedInvoice).period).sort()[0];
    candidates = candidates.filter((match) => match[position]?.period === oldest);
    if (candidates.length === 1) {
      return { status: 'oldest', invoiceIds: (candidates[0] ?? []).map((invoice) => invoice.id) };
    }
  }
  return { status: 'ambiguous' };
}
