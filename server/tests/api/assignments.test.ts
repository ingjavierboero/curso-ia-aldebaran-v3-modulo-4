import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { clientEvents, clientProducts } from '../../src/db/schema.ts';
import { createTestApp, loggedInAgent, type TestApp } from '../helpers/test-app.ts';
import { assignProduct, insertClient, insertProduct } from '../helpers/test-db.ts';

const assigned = (t: TestApp, clientId: number) =>
  t.db
    .select({ productId: clientProducts.productId })
    .from(clientProducts)
    .where(eq(clientProducts.clientId, clientId))
    .all()
    .map((r) => r.productId)
    .sort((a, b) => a - b);

const events = (t: TestApp, clientId: number) =>
  t.db.select().from(clientEvents).where(eq(clientEvents.clientId, clientId)).all();

const put = (agent: Awaited<ReturnType<typeof loggedInAgent>>['agent'], clientId: number, productIds: number[]) =>
  agent.put(`/api/clients/${clientId}/products`).send({ productIds });

describe('asignación de productos a un cliente (RF-49)', () => {
  it('AC-09: un Editor asigna un producto Activo a un cliente Activo y queda asignado', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'editor' });
    const client = insertClient(t.db);
    const product = insertProduct(t.db, { name: 'Abono', priceCents: 1_500_000, currency: 'ARS' });

    const res = await put(agent, client.id, [product.id]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({ id: product.id, name: 'Abono', priceCents: 1_500_000, currency: 'ARS', status: 'activo' }),
    ]);
    expect(assigned(t, client.id)).toEqual([product.id]);
  });

  it('AC-49: un Admin asigna varios productos Activos, en pesos y en dólares, y el cliente queda vinculado a todos', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const client = insertClient(t.db);
    const ars = insertProduct(t.db, { currency: 'ARS' });
    const usd = insertProduct(t.db, { currency: 'USD' });

    const res = await put(agent, client.id, [ars.id, usd.id]);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(assigned(t, client.id)).toEqual([ars.id, usd.id].sort((a, b) => a - b));
  });

  it('AC-47: un producto Inactivo no se puede asignar y nada cambia', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const client = insertClient(t.db);
    const active = insertProduct(t.db);
    const inactive = insertProduct(t.db, { status: 'inactivo' });

    const res = await put(agent, client.id, [active.id, inactive.id]);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('producto_inactivo');
    expect(assigned(t, client.id)).toEqual([]);
    expect(events(t, client.id)).toHaveLength(0);
  });

  it('AC-48: un producto Inactivo que ya estaba asignado se conserva al guardar la lista', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const client = insertClient(t.db);
    const inactive = insertProduct(t.db, { status: 'inactivo' });
    const other = insertProduct(t.db);
    assignProduct(t.db, client.id, inactive.id);

    const res = await put(agent, client.id, [inactive.id, other.id]);
    expect(res.status).toBe(200);
    expect(assigned(t, client.id)).toEqual([inactive.id, other.id].sort((a, b) => a - b));
  });

  it('un producto inexistente no se puede asignar y nada cambia', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const client = insertClient(t.db);
    const product = insertProduct(t.db);

    expect((await put(agent, client.id, [product.id, 999])).status).toBe(404);
    expect(assigned(t, client.id)).toEqual([]);
  });

  it('un id repetido en la lista se asigna una sola vez', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const client = insertClient(t.db);
    const product = insertProduct(t.db);

    expect((await put(agent, client.id, [product.id, product.id])).status).toBe(200);
    expect(assigned(t, client.id)).toEqual([product.id]);
  });

  it('una lista que no son ids enteros se rechaza', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const client = insertClient(t.db);
    expect((await agent.put(`/api/clients/${client.id}/products`).send({ productIds: ['a'] })).status).toBe(400);
    expect((await agent.put(`/api/clients/${client.id}/products`).send({})).status).toBe(400);
  });

  it('un cliente inexistente responde 404', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const product = insertProduct(t.db);
    expect((await put(agent, 999, [product.id])).status).toBe(404);
  });

  it('RF-13: un usuario Consulta no puede asignar ni desasignar productos', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'consulta' });
    const client = insertClient(t.db);
    const product = insertProduct(t.db);
    assignProduct(t.db, client.id, product.id);

    expect((await put(agent, client.id, [])).status).toBe(403);
    expect(assigned(t, client.id)).toEqual([product.id]);
  });
});

describe('productos asignados a un cliente', () => {
  it('cualquier perfil ve los productos asignados a un cliente, con su precio, moneda y estado', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'consulta' });
    const client = insertClient(t.db);
    const product = insertProduct(t.db, { name: 'Abono', priceCents: 100, currency: 'USD', status: 'inactivo' });
    insertProduct(t.db, { name: 'Sin asignar' });
    assignProduct(t.db, client.id, product.id);

    const res = await agent.get(`/api/clients/${client.id}/products`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({ id: product.id, name: 'Abono', priceCents: 100, currency: 'USD', status: 'inactivo' }),
    ]);
  });

  it('los productos de un cliente inexistente responden 404', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const res = await agent.get('/api/clients/999/products');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('no_encontrado');
  });
});

describe('desasignación de productos (RF-50)', () => {
  it('AC-50: un Editor desasigna uno de dos productos asignados y el cliente queda solo con el otro', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'editor' });
    const client = insertClient(t.db);
    const kept = insertProduct(t.db);
    const removed = insertProduct(t.db);
    assignProduct(t.db, client.id, kept.id);
    assignProduct(t.db, client.id, removed.id);

    const res = await put(agent, client.id, [kept.id]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([expect.objectContaining({ id: kept.id })]);
    expect(assigned(t, client.id)).toEqual([kept.id]);
  });

  it('se pueden desasignar todos los productos con una lista vacía', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const client = insertClient(t.db);
    const product = insertProduct(t.db);
    assignProduct(t.db, client.id, product.id);

    expect((await put(agent, client.id, [])).status).toBe(200);
    expect(assigned(t, client.id)).toEqual([]);
  });
});

describe('eventos en el historial del cliente (RF-163)', () => {
  it('cada asignación y desasignación queda en el historial con el producto, el usuario y la fecha', async () => {
    const t = createTestApp({ now: '2026-10-20T15:00:00Z' });
    const { agent, user } = await loggedInAgent(t, { role: 'editor' });
    const client = insertClient(t.db);
    const kept = insertProduct(t.db, { name: 'Abono' });
    const removed = insertProduct(t.db, { name: 'Soporte' });
    const added = insertProduct(t.db, { name: 'Hosting' });
    assignProduct(t.db, client.id, kept.id);
    assignProduct(t.db, client.id, removed.id);

    expect((await put(agent, client.id, [kept.id, added.id])).status).toBe(200);

    const recorded = events(t, client.id);
    expect(recorded).toHaveLength(2);
    expect(recorded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'producto_asignado',
          payload: expect.objectContaining({ productId: added.id, productName: 'Hosting' }),
          actorType: 'usuario',
          userId: user.id,
          occurredAt: '2026-10-20T15:00:00.000Z',
        }),
        expect.objectContaining({
          type: 'producto_desasignado',
          payload: expect.objectContaining({ productId: removed.id, productName: 'Soporte' }),
          actorType: 'usuario',
          userId: user.id,
        }),
      ]),
    );
  });

  it('guardar la misma lista no registra eventos', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const client = insertClient(t.db);
    const product = insertProduct(t.db);
    assignProduct(t.db, client.id, product.id);

    expect((await put(agent, client.id, [product.id])).status).toBe(200);
    expect(events(t, client.id)).toHaveLength(0);
  });
});
