import { asc, eq } from 'drizzle-orm';
import type { Conn } from '../db/client.ts';
import { clientEvents, users } from '../db/schema.ts';
import type { ClientEventDto } from '../http/types.ts';

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

/** Historial del cliente en orden cronológico, con el usuario o el agente que originó cada evento (RF-163). */
export function listClientHistory(conn: Conn, clientId: number): ClientEventDto[] {
  return conn
    .select({ event: clientEvents, userName: users.name })
    .from(clientEvents)
    .leftJoin(users, eq(users.id, clientEvents.userId))
    .where(eq(clientEvents.clientId, clientId))
    .orderBy(asc(clientEvents.occurredAt), asc(clientEvents.id))
    .all()
    .map(({ event, userName }) => ({
      id: event.id,
      type: event.type,
      occurredAt: event.occurredAt,
      actor: { type: event.actorType, userId: event.userId, userName: userName ?? null },
      payload: event.payload as Record<string, unknown>,
    }));
}
