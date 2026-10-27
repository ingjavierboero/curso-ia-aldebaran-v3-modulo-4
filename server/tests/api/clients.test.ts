import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { clients } from '../../src/db/schema.ts';
import { createTestApp, loggedInAgent, type TestApp } from '../helpers/test-app.ts';
import { insertClient } from '../helpers/test-db.ts';

/** Datos válidos de un cliente nuevo (RF-34). 30711111111 tiene dígito verificador válido. */
const VALID = {
  businessName: 'Los Andes SRL',
  cuit: '30711111111',
  address: 'Av. Corrientes 1234, CABA',
  billingEmail: 'pagos@losandes.com',
  ivaCondition: 1,
};

/** Otro CUIT válido, para un segundo cliente. */
const OTHER_VALID_CUIT = '20111111112';

/** Las 11 condiciones frente al IVA de RF-38. */
const IVA_CONDITIONS = [1, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16];

const row = (t: TestApp, id: number) => t.db.select().from(clients).where(eq(clients.id, id)).get();
const allClients = (t: TestApp) => t.db.select().from(clients).all();

describe('alta de clientes (RF-34, RF-38)', () => {
  it('AC-34: un Admin da de alta un cliente con los datos obligatorios; queda Activo y visible en el listado', async () => {
    const t = createTestApp({ now: '2026-10-20T12:00:00Z' });
    const { agent } = await loggedInAgent(t, { role: 'admin' });

    const res = await agent.post('/api/clients').send(VALID);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ...VALID, status: 'activo' });
    expect(res.body.id).toEqual(expect.any(Number));

    const list = await agent.get('/api/clients');
    expect(list.status).toBe(200);
    expect(list.body).toEqual([expect.objectContaining({ id: res.body.id, businessName: 'Los Andes SRL', status: 'activo' })]);
  });

  it('AC-08: un Editor da de alta un cliente y queda registrado', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'editor' });
    expect((await agent.post('/api/clients').send(VALID)).status).toBe(201);
    expect(allClients(t)).toHaveLength(1);
  });

  it('RF-13: un usuario Consulta no puede dar de alta un cliente', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'consulta' });
    expect((await agent.post('/api/clients').send(VALID)).status).toBe(403);
    expect(allClients(t)).toHaveLength(0);
  });

  for (const field of ['businessName', 'cuit', 'address', 'billingEmail', 'ivaCondition'] as const) {
    it(`AC-34, AC-40: sin ${field} se rechaza el alta`, async () => {
      const t = createTestApp();
      const { agent } = await loggedInAgent(t, { role: 'admin' });
      const { [field]: _omitted, ...body } = VALID;

      const res = await agent.post('/api/clients').send(body);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.error.details)).toContain(field);
      expect(allClients(t)).toHaveLength(0);
    });
  }

  it('AC-34: un dato obligatorio con solo espacios se rechaza', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    expect((await agent.post('/api/clients').send({ ...VALID, businessName: '   ' })).status).toBe(400);
    expect(allClients(t)).toHaveLength(0);
  });

  it('AC-40, RF-38: se aceptan las 11 condiciones frente al IVA de ARCA para el receptor de una Factura C', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    // CUIT válidos distintos: el dígito verificador se calcula para cada prefijo.
    const cuits = [
      '20111111112',
      '20222222223',
      '20333333334',
      '20444444445',
      '20555555556',
      '20666666667',
      '20777777778',
      '20888888889',
      '27111111117',
      '27222222228',
      '30711111111',
    ];
    for (const [i, ivaCondition] of IVA_CONDITIONS.entries()) {
      const body = { ...VALID, cuit: cuits[i], billingEmail: `cliente${i}@clientes.com`, ivaCondition };
      expect((await agent.post('/api/clients').send(body)).status, `condición ${ivaCondition}`).toBe(201);
    }
  });

  for (const ivaCondition of [0, 2, 3, 11, 12, 14, 17, 'Monotributo']) {
    it(`AC-40: la condición frente al IVA ${JSON.stringify(ivaCondition)} se rechaza`, async () => {
      const t = createTestApp();
      const { agent } = await loggedInAgent(t, { role: 'admin' });
      const res = await agent.post('/api/clients').send({ ...VALID, ivaCondition });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.error.details)).toContain('ivaCondition');
      expect(allClients(t)).toHaveLength(0);
    });
  }
});

describe('CUIT con dígito verificador inválido (RF-39)', () => {
  it('AC-41: el alta con el CUIT 30711111118 se rechaza y con 30711111111 se realiza', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });

    const rejected = await agent.post('/api/clients').send({ ...VALID, cuit: '30711111118' });
    expect(rejected.status).toBe(400);
    expect(JSON.stringify(rejected.body.error.details)).toContain('cuit');
    expect(allClients(t)).toHaveLength(0);

    expect((await agent.post('/api/clients').send({ ...VALID, cuit: '30711111111' })).status).toBe(201);
  });

  it('AC-41: modificar un cliente para que tenga el CUIT 30711111118 se rechaza y nada cambia; con 30711111111 se realiza', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'editor' });
    const client = insertClient(t.db, { cuit: OTHER_VALID_CUIT });
    const before = row(t, client.id);

    expect((await agent.patch(`/api/clients/${client.id}`).send({ cuit: '30711111118' })).status).toBe(400);
    expect(row(t, client.id)).toEqual(before);

    const res = await agent.patch(`/api/clients/${client.id}`).send({ cuit: '30711111111' });
    expect(res.status).toBe(200);
    expect(row(t, client.id)?.cuit).toBe('30711111111');
  });

  it('un CUIT que no tiene 11 dígitos se rechaza', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    for (const cuit of ['3071111111', '307111111111', '3071111111a']) {
      expect((await agent.post('/api/clients').send({ ...VALID, cuit })).status, cuit).toBe(400);
    }
    expect(allClients(t)).toHaveLength(0);
  });
});

describe('CUIT y email de facturación duplicados (RF-40, RF-41)', () => {
  it('AC-42: con un cliente registrado con el CUIT 30711111111 y el email pagos@losandes.com, el alta con ese CUIT o con Pagos@LosAndes.com se rechaza', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    insertClient(t.db, { cuit: '30711111111', billingEmail: 'pagos@losandes.com' });

    const sameCuit = await agent.post('/api/clients').send({ ...VALID, billingEmail: 'otro@cliente.com' });
    expect(sameCuit.status).toBe(409);
    expect(sameCuit.body.error.code).toBe('cuit_duplicado');
    const sameEmail = await agent.post('/api/clients').send({ ...VALID, cuit: OTHER_VALID_CUIT, billingEmail: 'Pagos@LosAndes.com' });
    expect(sameEmail.status).toBe(409);
    expect(sameEmail.body.error.code).toBe('email_duplicado');
    expect(allClients(t)).toHaveLength(1);
  });

  it('AC-42: modificar otro cliente para que tenga el CUIT o el email (con otras mayúsculas) de un cliente registrado se rechaza y nada cambia', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'editor' });
    insertClient(t.db, { cuit: '30711111111', billingEmail: 'pagos@losandes.com' });
    const other = insertClient(t.db, { cuit: OTHER_VALID_CUIT, billingEmail: 'otro@cliente.com' });
    const before = row(t, other.id);

    const cuit = await agent.patch(`/api/clients/${other.id}`).send({ cuit: '30711111111' });
    expect(cuit.status).toBe(409);
    expect(cuit.body.error.code).toBe('cuit_duplicado');
    const email = await agent.patch(`/api/clients/${other.id}`).send({ billingEmail: 'Pagos@LosAndes.com' });
    expect(email.status).toBe(409);
    expect(email.body.error.code).toBe('email_duplicado');
    expect(row(t, other.id)).toEqual(before);
  });

  it('un cliente puede guardar sus propios CUIT y email sin que cuenten como duplicados', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const client = insertClient(t.db, { cuit: '30711111111', billingEmail: 'pagos@losandes.com' });
    const res = await agent
      .patch(`/api/clients/${client.id}`)
      .send({ cuit: '30711111111', billingEmail: 'PAGOS@losandes.com', businessName: 'Los Andes SA' });
    expect(res.status).toBe(200);
    expect(row(t, client.id)).toMatchObject({ businessName: 'Los Andes SA', billingEmail: 'PAGOS@losandes.com' });
  });
});

describe('baja y reactivación (RF-36, RF-37)', () => {
  it('AC-38: un Editor da de baja un cliente Activo, que pasa a Inactivo y sigue en el listado con ese estado', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'editor' });
    const client = insertClient(t.db);

    const res = await agent.post(`/api/clients/${client.id}/deactivate`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('inactivo');
    expect(row(t, client.id)?.status).toBe('inactivo');

    const list = await agent.get('/api/clients');
    expect(list.body).toEqual([expect.objectContaining({ id: client.id, status: 'inactivo' })]);
  });

  it('RF-37: un cliente Inactivo se reactiva y vuelve a Activo', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const client = insertClient(t.db, { status: 'inactivo' });

    const res = await agent.post(`/api/clients/${client.id}/reactivate`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('activo');
    expect(row(t, client.id)?.status).toBe('activo');
  });

  it('RF-13: un usuario Consulta no puede dar de baja, reactivar ni modificar un cliente', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'consulta' });
    const client = insertClient(t.db);
    const before = row(t, client.id);

    expect((await agent.post(`/api/clients/${client.id}/deactivate`)).status).toBe(403);
    expect((await agent.post(`/api/clients/${client.id}/reactivate`)).status).toBe(403);
    expect((await agent.patch(`/api/clients/${client.id}`).send({ businessName: 'Otro' })).status).toBe(403);
    expect(row(t, client.id)).toEqual(before);
  });

  it('un cliente inexistente responde 404', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    expect((await agent.post('/api/clients/999/deactivate')).status).toBe(404);
    expect((await agent.patch('/api/clients/999').send({ businessName: 'Otro' })).status).toBe(404);
  });
});
