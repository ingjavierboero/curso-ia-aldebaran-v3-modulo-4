/** Estados de una factura y quién puede cambiarlos (data-model.md). */
export type InvoiceStatus = 'generando' | 'pendiente_de_pago' | 'pago_recibido' | 'revision_manual' | 'pagada';
export type Actor = 'agente' | 'usuario';

/** Factura adeudada: Pendiente de pago o Revisión manual (PRD, Definiciones). */
export const OWED_STATUSES: readonly InvoiceStatus[] = ['pendiente_de_pago', 'revision_manual'];

const ALLOWED: Record<Actor, ReadonlyArray<readonly [InvoiceStatus, InvoiceStatus]>> = {
  agente: [
    ['generando', 'pendiente_de_pago'], // obtuvo el CAE
    ['pendiente_de_pago', 'pago_recibido'], // RF-134, RF-135
    ['pendiente_de_pago', 'revision_manual'], // RF-128, RF-130 a RF-133, RF-136, RF-137
    ['revision_manual', 'revision_manual'], // RF-128, RF-129: se reemplaza el motivo
  ],
  usuario: [
    ['pago_recibido', 'pagada'], // RF-143
    ['pago_recibido', 'pendiente_de_pago'], // RF-144
    ['revision_manual', 'pagada'], // RF-145
    ['revision_manual', 'pendiente_de_pago'], // RF-146
    ['pendiente_de_pago', 'pagada'], // RF-147
  ],
};

export class InvalidTransitionError extends Error {}

export function canTransition(from: InvoiceStatus, to: InvoiceStatus, actor: Actor): boolean {
  // El agente nunca pasa una factura a Pagada (Constitución, Principio III; FR-026).
  if (actor === 'agente' && to === 'pagada') return false;
  return ALLOWED[actor].some(([f, t]) => f === from && t === to);
}

export function assertTransition(from: InvoiceStatus, to: InvoiceStatus, actor: Actor): void {
  if (!canTransition(from, to, actor)) {
    throw new InvalidTransitionError(`El ${actor} no puede pasar una factura de ${from} a ${to}.`);
  }
}

/**
 * Motivo que queda en la factura después de la transición: solo las facturas en Revisión manual
 * tienen motivo (RF-138), y se borra al salir de ese estado (RF-140).
 */
export function reasonAfterTransition(to: InvoiceStatus, reason: string | null): string | null {
  if (to !== 'revision_manual') return null;
  if (!reason) throw new InvalidTransitionError('Una factura en Revisión manual necesita un motivo.');
  return reason;
}
