import { and, asc, eq, ne } from 'drizzle-orm';
import type { Conn, Db } from '../db/client.ts';
import { clients } from '../db/schema.ts';
import type { ClientInput } from '../http/types.ts';
import { normalizeEmail } from './auth.ts';
import { type ActorRef, recordClientEvent } from './history.ts';

export type Client = typeof clients.$inferSelect;

/** El CUIT ya lo tiene otro cliente (RF-40). */
export class DuplicateCuitError extends Error {}
/** El email de facturación ya lo tiene otro cliente, sin distinguir mayúsculas (RF-41). */
export class DuplicateBillingEmailError extends Error {}
export class ClientNotFoundError extends Error {}

export function listClients(conn: Conn): Client[] {
  return conn.select().from(clients).orderBy(asc(clients.businessName), asc(clients.id)).all();
}

export function getClient(conn: Conn, id: number): Client {
  const client = conn.select().from(clients).where(eq(clients.id, id)).get();
  if (!client) throw new ClientNotFoundError('El cliente no existe.');
  return client;
}

/** RF-40 y RF-41: el CUIT y el email de facturación no pueden ser de otro cliente. */
function assertUnique(conn: Conn, data: { cuit?: string; billingEmail?: string }, exceptId?: number) {
  const others = (condition: ReturnType<typeof eq>) =>
    conn
      .select({ id: clients.id })
      .from(clients)
      .where(exceptId ? and(condition, ne(clients.id, exceptId)) : condition)
      .get();

  if (data.cuit !== undefined && others(eq(clients.cuit, data.cuit))) {
    throw new DuplicateCuitError('Ya existe un cliente con ese CUIT.');
  }
  const email = data.billingEmail === undefined ? undefined : normalizeEmail(data.billingEmail);
  if (email !== undefined && others(eq(clients.billingEmailNormalized, email))) {
    throw new DuplicateBillingEmailError('Ya existe un cliente con ese email de facturación.');
  }
}

/** RF-34: alta de un cliente, que queda Activo; registra el evento de alta en su historial. */
export function createClient(db: Db, input: ClientInput, actor: ActorRef, now: Date): Client {
  const at = now.toISOString();
  return db.transaction((tx) => {
    assertUnique(tx, input);
    const client = tx
      .insert(clients)
      .values({
        ...input,
        billingEmailNormalized: normalizeEmail(input.billingEmail),
        status: 'activo',
        createdAt: at,
        updatedAt: at,
      })
      .returning()
      .get();
    recordClientEvent(tx, { clientId: client.id, type: 'alta', payload: { ...input }, actor, at: now });
    return client;
  });
}

/**
 * RF-35: modifica los datos enviados. El historial registra solo los campos que cambiaron, con su
 * valor anterior y el nuevo; si no cambió nada, no registra ningún evento.
 */
export function updateClient(db: Db, id: number, changes: Partial<ClientInput>, actor: ActorRef, now: Date): Client {
  return db.transaction((tx) => {
    const client = getClient(tx, id);
    assertUnique(tx, changes, id);

    const changed: Record<string, { from: unknown; to: unknown }> = {};
    for (const [field, to] of Object.entries(changes) as Array<[keyof ClientInput, unknown]>) {
      if (to !== undefined && client[field] !== to) changed[field] = { from: client[field], to };
    }
    if (Object.keys(changed).length === 0) return client;

    const updated = tx
      .update(clients)
      .set({
        ...changes,
        ...(changes.billingEmail !== undefined && { billingEmailNormalized: normalizeEmail(changes.billingEmail) }),
        updatedAt: now.toISOString(),
      })
      .where(eq(clients.id, id))
      .returning()
      .get() as Client;
    recordClientEvent(tx, { clientId: id, type: 'modificacion', payload: { changes: changed }, actor, at: now });
    return updated;
  });
}

/** RF-36 y RF-37: baja (pasa a Inactivo) o reactivación (vuelve a Activo), con su evento. */
export function setClientStatus(db: Db, id: number, status: Client['status'], actor: ActorRef, now: Date): Client {
  return db.transaction((tx) => {
    const client = getClient(tx, id);
    if (client.status === status) return client;
    const updated = tx
      .update(clients)
      .set({ status, updatedAt: now.toISOString() })
      .where(eq(clients.id, id))
      .returning()
      .get() as Client;
    recordClientEvent(tx, { clientId: id, type: status === 'inactivo' ? 'baja' : 'reactivacion', actor, at: now });
    return updated;
  });
}
