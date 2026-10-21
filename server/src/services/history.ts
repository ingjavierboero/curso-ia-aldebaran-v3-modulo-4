import type { Conn } from '../db/client.ts';
import { clientEvents } from '../db/schema.ts';

/** Quién originó un evento del historial: el agente o un usuario (RF-163). */
export type ActorRef = { type: 'agente' } | { type: 'usuario'; userId: number };

/** Tipos de evento del historial del cliente (PRD, Definiciones: "Historial del cliente"). */
export type ClientEventType =
  | 'alta'
  | 'modificacion'
  | 'baja'
  | 'reactivacion'
  | 'producto_asignado'
  | 'producto_desasignado'
  | 'factura_generada'
  | 'email_enviado'
  | 'email_recibido'
  | 'estado_factura'
  | 'error_proceso'
  | 'recordatorio_cancelado';

export interface ClientEvent {
  clientId: number;
  type: ClientEventType;
  /** Detalle del evento, por ejemplo los campos modificados o la clasificación de cada adjunto. */
  payload?: Record<string, unknown>;
  actor: ActorRef;
  at: Date;
}

/**
 * Registra un evento en el historial del cliente. Se llama con la misma transacción del cambio que
 * registra, para que el cambio y su evento queden guardados juntos o no quede ninguno.
 */
export function recordClientEvent(conn: Conn, event: ClientEvent): void {
  conn
    .insert(clientEvents)
    .values({
      clientId: event.clientId,
      type: event.type,
      payload: event.payload ?? {},
      actorType: event.actor.type,
      userId: event.actor.type === 'usuario' ? event.actor.userId : null,
      occurredAt: event.at.toISOString(),
    })
    .run();
}
