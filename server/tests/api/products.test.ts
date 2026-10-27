import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { products } from '../../src/db/schema.ts';
import { createTestApp, loggedInAgent, type TestApp } from '../helpers/test-app.ts';
import { insertProduct } from '../helpers/test-db.ts';

/** Precios en centavos (RNF-13): $15.000,00 son 1.500.000 centavos. */
const VALID = { name: 'Abono mensual', priceCents: 1_500_000, currency: 'ARS' };

const row = (t: TestApp, id: number) => t.db.select().from(products).where(eq(products.id, id)).get();
const allProducts = (t: TestApp) => t.db.select().from(products).all();

describe('alta de productos (RF-42 a RF-44)', () => {
  it('AC-43: un Admin da de alta un producto en pesos y queda Activo con ese precio y esa moneda', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });

    const res = await agent.post('/api/products').send(VALID);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ...VALID, status: 'activo' });
    expect(row(t, res.body.id)).toMatchObject({ ...VALID, status: 'activo' });
  });

  it('AC-43: un Editor da de alta un producto en dólares', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'editor' });

    const res = await agent.post('/api/products').send({ name: 'Soporte', priceCents: 12_050, currency: 'USD' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Soporte', priceCents: 12_050, currency: 'USD', status: 'activo' });
  });

  it('RF-159: el listado muestra los productos Activos e Inactivos con nombre, precio, moneda y estado', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'consulta' });
    const active = insertProduct(t.db, { name: 'Abono', priceCents: 100, currency: 'ARS' });
    const inactive = insertProduct(t.db, { name: 'Viejo', priceCents: 200, currency: 'USD', status: 'inactivo' });

    const res = await agent.get('/api/products');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: active.id, name: 'Abono', priceCents: 100, currency: 'ARS', status: 'activo' }),
        expect.objectContaining({ id: inactive.id, name: 'Viejo', priceCents: 200, currency: 'USD', status: 'inactivo' }),
      ]),
    );
    expect(res.body).toHaveLength(2);
  });

  it('RF-13: un usuario Consulta no puede dar de alta un producto', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'consulta' });
    expect((await agent.post('/api/products').send(VALID)).status).toBe(403);
    expect(allProducts(t)).toHaveLength(0);
  });

  for (const field of ['name', 'priceCents', 'currency'] as const) {
    it(`sin ${field} se rechaza el alta`, async () => {
      const t = createTestApp();
      const { agent } = await loggedInAgent(t, { role: 'admin' });
      const { [field]: _omitted, ...body } = VALID;
      const res = await agent.post('/api/products').send(body);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.error.details)).toContain(field);
      expect(allProducts(t)).toHaveLength(0);
    });
  }

  it('RF-43: una moneda que no es pesos ni dólares se rechaza', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const res = await agent.post('/api/products').send({ ...VALID, currency: 'EUR' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.error.details)).toContain('currency');
    expect(allProducts(t)).toHaveLength(0);
  });

  for (const [label, priceCents] of [
    ['0', 0],
    ['-100', -10_000],
  ] as const) {
    it(`AC-44: el alta con precio ${label} se rechaza`, async () => {
      const t = createTestApp();
      const { agent } = await loggedInAgent(t, { role: 'admin' });
      const res = await agent.post('/api/products').send({ ...VALID, priceCents });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.error.details)).toContain('priceCents');
      expect(allProducts(t)).toHaveLength(0);
    });
  }

  it('AC-44: el alta con precio 0,01 se realiza', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const res = await agent.post('/api/products').send({ ...VALID, priceCents: 1 });
    expect(res.status).toBe(201);
    expect(row(t, res.body.id)?.priceCents).toBe(1);
  });

  it('RNF-13: un precio con fracción de centavo se rechaza', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    expect((await agent.post('/api/products').send({ ...VALID, priceCents: 150.5 })).status).toBe(400);
    expect(allProducts(t)).toHaveLength(0);
  });
});

describe('modificación de productos (RF-44 a RF-46)', () => {
  it('RF-45, RF-46: un Editor modifica el nombre, el precio y la moneda', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'editor' });
    const product = insertProduct(t.db, { name: 'Abono', priceCents: 100_000, currency: 'ARS' });

    const res = await agent.patch(`/api/products/${product.id}`).send({ name: 'Abono plus', priceCents: 5_000, currency: 'USD' });
    expect(res.status).toBe(200);
    expect(row(t, product.id)).toMatchObject({ name: 'Abono plus', priceCents: 5_000, currency: 'USD' });
  });

  it('AC-44: modificar el precio a 0 se rechaza y nada cambia; a 0,01 se realiza', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const product = insertProduct(t.db);
    const before = row(t, product.id);

    const rejected = await agent.patch(`/api/products/${product.id}`).send({ priceCents: 0 });
    expect(rejected.status).toBe(400);
    expect(row(t, product.id)).toEqual(before);

    expect((await agent.patch(`/api/products/${product.id}`).send({ priceCents: 1 })).status).toBe(200);
    expect(row(t, product.id)?.priceCents).toBe(1);
  });

  it('un nombre vacío se rechaza y nada cambia', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const product = insertProduct(t.db);
    const before = row(t, product.id);
    expect((await agent.patch(`/api/products/${product.id}`).send({ name: '  ' })).status).toBe(400);
    expect(row(t, product.id)).toEqual(before);
  });
});

describe('desactivación y reactivación (RF-47, RF-48)', () => {
  it('AC-47: un Editor desactiva un producto Activo, que pasa a Inactivo y sigue en el listado con ese estado', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'editor' });
    const product = insertProduct(t.db);

    const res = await agent.post(`/api/products/${product.id}/deactivate`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('inactivo');
    expect(row(t, product.id)?.status).toBe('inactivo');

    const list = await agent.get('/api/products');
    expect(list.body).toEqual([expect.objectContaining({ id: product.id, status: 'inactivo' })]);
  });

  it('AC-48: un Admin reactiva un producto Inactivo, que vuelve a Activo', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const product = insertProduct(t.db, { status: 'inactivo' });

    const res = await agent.post(`/api/products/${product.id}/reactivate`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('activo');
    expect(row(t, product.id)?.status).toBe('activo');
  });

  it('RF-13: un usuario Consulta no puede modificar, desactivar ni reactivar un producto', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'consulta' });
    const product = insertProduct(t.db);
    const before = row(t, product.id);

    expect((await agent.patch(`/api/products/${product.id}`).send({ name: 'Otro' })).status).toBe(403);
    expect((await agent.post(`/api/products/${product.id}/deactivate`)).status).toBe(403);
    expect((await agent.post(`/api/products/${product.id}/reactivate`)).status).toBe(403);
    expect(row(t, product.id)).toEqual(before);
  });

  it('un producto inexistente responde 404', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    expect((await agent.patch('/api/products/999').send({ name: 'Otro' })).status).toBe(404);
    expect((await agent.post('/api/products/999/deactivate')).status).toBe(404);
  });
});
