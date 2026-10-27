import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import type { Conn, Db } from '../db/client.ts';
import { clientProducts, clients, products } from '../db/schema.ts';
import type { ClientInput } from '../http/types.ts';
import { normalizeEmail } from './auth.ts';
import { type ActorRef, recordClientEvent } from './history.ts';
import { type Product, ProductNotFoundError } from './products.ts';

export type Client = typeof clients.$inferSelect;

/** El CUIT ya lo tiene otro cliente (RF-40). */
export class DuplicateCuitError extends Error {}
/** El email de facturación ya lo tiene otro cliente, sin distinguir mayúsculas (RF-41). */
export class DuplicateBillingEmailError extends Error {}
export class ClientNotFoundError extends Error {}
/** Solo se asignan productos Activos (RF-49, AC-47). */
export class InactiveProductError extends Error {}

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

/** Productos asignados al cliente, ordenados por nombre. */
export function listClientProducts(conn: Conn, clientId: number): Product[] {
  getClient(conn, clientId);
  return conn
    .select({ product: products })
    .from(clientProducts)
    .innerJoin(products, eq(clientProducts.productId, products.id))
    .where(eq(clientProducts.clientId, clientId))
    .orderBy(asc(products.name), asc(products.id))
    .all()
    .map((row) => row.product);
}

/**
 * RF-49 y RF-50: deja asignados al cliente exactamente los productos indicados. Los nuevos tienen que
 * estar Activos; uno Inactivo que ya estaba asignado se conserva. Cada asignación y desasignación
 * queda en el historial del cliente, en la misma transacción.
 */
export function setClientProducts(
  db: Db,
  clientId: number,
  productIds: number[],
  actor: ActorRef,
  now: Date,
): Product[] {
  return db.transaction((tx) => {
    getClient(tx, clientId);
    const ids = [...new Set(productIds)];
    const requested = ids.length === 0 ? [] : tx.select().from(products).where(inArray(products.id, ids)).all();
    if (requested.length !== ids.length) throw new ProductNotFoundError('Alguno de los productos no existe.');

    const current = new Map(listClientProducts(tx, clientId).map((product) => [product.id, product]));
    const added = requested.filter((product) => !current.has(product.id));
    const removed = [...current.values()].filter((product) => !ids.includes(product.id));

    const inactive = added.filter((product) => product.status !== 'activo');
    if (inactive.length > 0) {
      const names = inactive.map((product) => product.name).join(', ');
      throw new InactiveProductError(`Solo se pueden asignar productos Activos. Inactivos: ${names}.`);
    }

    const at = now.toISOString();
    for (const product of added) {
      tx.insert(clientProducts).values({ clientId, productId: product.id, assignedAt: at }).run();
      const payload = { productId: product.id, productName: product.name };
      recordClientEvent(tx, { clientId, type: 'producto_asignado', payload, actor, at: now });
    }
    for (const product of removed) {
      tx.delete(clientProducts)
        .where(and(eq(clientProducts.clientId, clientId), eq(clientProducts.productId, product.id)))
        .run();
      const payload = { productId: product.id, productName: product.name };
      recordClientEvent(tx, { clientId, type: 'producto_desasignado', payload, actor, at: now });
    }
    return listClientProducts(tx, clientId);
  });
}
