import { findAmountMatches, pickMatch } from './amount-matching.ts';
import { cuitsMatch, parseExtractedCuit } from './cuit.ts';
import type { Classification } from './email-classification.ts';
import { parseExtractedAmount } from './money.ts';

/** Factura adeudada del cliente con su estado actual (PRD, Definiciones: "Factura adeudada"). */
export interface OwedInvoiceState {
  id: number;
  period: string;
  totalCents: number;
  status: 'pendiente_de_pago' | 'revision_manual';
}

/** Comprobante (adjunto "si") con el CUIT y el monto tal como los extrajo el LLM, o null si no se pudieron. */
export interface Receipt {
  cuit: string | null;
  amountRaw: string | null;
}

export interface PaymentInput {
  /** Clasificación del email (RF-123). */
  classification: Classification;
  clientCuit: string;
  owedInvoices: OwedInvoiceState[];
  receipts: Receipt[];
}

export type PaymentRule = `RF-${126 | 127 | 128 | 130 | 131 | 132 | 133 | 134 | 135 | 136 | 137}`;

/** Decisión para un email: exactamente una de las reglas RF-126 a RF-137, con su acción. */
export type PaymentDecision =
  | { rule: PaymentRule; action: 'ninguna' }
  | { rule: PaymentRule; action: 'pago_recibido'; invoiceIds: number[] }
  | { rule: PaymentRule; action: 'revision_manual'; reason: string; invoiceIds: number[] };

/** Motivos literales de Revisión manual (RF-138). */
export const REASONS = {
  'RF-128': 'revisión manual pendiente',
  'RF-130': 'no se pudo procesar el comprobante',
  'RF-131': 'clasificación dudosa',
  'RF-132': 'no se pudieron extraer el CUIT o el monto',
  'RF-133': 'CUIT no coincide',
  'RF-136': 'no se pudo determinar qué facturas cancela el pago',
  'RF-137': 'monto no coincide',
} as const;

type ReviewRule = keyof typeof REASONS;

/**
 * Aplica las reglas RF-126 a RF-137 a un email con adjunto, en orden: sus condiciones son excluyentes,
 * así que a cada email le corresponde exactamente una. Las facturas que pasan a Revisión manual son todas
 * las adeudadas del cliente, de la más antigua a la más reciente.
 */
export function decidePayment(input: PaymentInput): PaymentDecision {
  const owed = [...input.owedInvoices].sort((a, b) => a.period.localeCompare(b.period) || a.id - b.id);
  const review = (rule: ReviewRule): PaymentDecision => ({
    rule,
    action: 'revision_manual',
    reason: REASONS[rule],
    invoiceIds: owed.map((invoice) => invoice.id),
  });

  if (input.classification === 'no') return { rule: 'RF-126', action: 'ninguna' };
  if (owed.length === 0) return { rule: 'RF-127', action: 'ninguna' }; // sin deuda vigente
  if (owed.some((invoice) => invoice.status === 'revision_manual')) return review('RF-128'); // en revisión
  if (input.classification === 'error') return review('RF-130');
  if (input.classification === 'dudoso') return review('RF-131');

  // Clasificación "si": CUIT (RF-122: menos de 11 dígitos es no extraído) y monto de cada comprobante.
  const receipts = input.receipts.map((receipt) => ({
    cuit: parseExtractedCuit(receipt.cuit),
    amount: parseExtractedAmount(receipt.amountRaw),
  }));
  if (receipts.some((receipt) => receipt.cuit === null || receipt.amount.status === 'missing')) return review('RF-132');
  if (receipts.some((receipt) => !cuitsMatch(receipt.cuit ?? '', input.clientCuit))) return review('RF-133'); // RF-125

  // Email validable. Un monto extraído pero inválido no tiene coincidencias (RNF-13).
  const amounts = receipts.map((receipt) => (receipt.amount.status === 'ok' ? receipt.amount.cents : 0));
  const decision = pickMatch(findAmountMatches(owed, amounts));
  switch (decision.status) {
    case 'unique':
      return { rule: 'RF-134', action: 'pago_recibido', invoiceIds: decision.invoiceIds };
    case 'oldest':
      return { rule: 'RF-135', action: 'pago_recibido', invoiceIds: decision.invoiceIds };
    case 'ambiguous':
      return review('RF-136');
    case 'none':
      return review('RF-137');
  }
}
