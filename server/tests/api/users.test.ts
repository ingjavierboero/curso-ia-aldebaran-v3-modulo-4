import { eq } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { users } from '../../src/db/schema.ts';
import { createTestApp, loggedInAgent } from '../helpers/test-app.ts';
import { insertUser, TEST_PASSWORD } from '../helpers/test-db.ts';

const login = (t: ReturnType<typeof createTestApp>, email: string, password: string) =>
  request(t.app).post('/api/auth/login').send({ email, password });

const userRow = (t: ReturnType<typeof createTestApp>, id: number) =>
  t.db.select().from(users).where(eq(users.id, id)).get();

describe('alta de usuarios (RF-14, RF-15)', () => {
  it('AC-14: un Admin da de alta usuarios Admin, Editor y Consulta, que quedan Activos y pueden iniciar sesión', async () => {
    const t = createTestApp();
    const { agent: admin } = await loggedInAgent(t);

    for (const role of ['admin', 'editor', 'consulta'] as const) {
      const email = `${role}@empresa.com`;
      const res = await admin.post('/api/users').send({ name: `Usuario ${role}`, email, role, password: 'clave-segura' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: `Usuario ${role}`, email, role, status: 'activo' });
      expect((await login(t, email, 'clave-segura')).status).toBe(200);
    }
  });

  it('rechaza un perfil inexistente o datos incompletos', async () => {
    const t = createTestApp();
    const { agent: admin } = await loggedInAgent(t);
    const before = t.db.select().from(users).all().length;
    const invalid = [
      { name: 'X', email: 'x@empresa.com', role: 'superusuario', password: 'clave-segura' },
      { name: '', email: 'x@empresa.com', role: 'editor', password: 'clave-segura' },
      { name: 'X', email: 'no-es-un-email', role: 'editor', password: 'clave-segura' },
    ];
    for (const body of invalid) expect((await admin.post('/api/users').send(body)).status).toBe(400);
    expect(t.db.select().from(users).all()).toHaveLength(before);
  });

  it('AC-15: rechaza dar de alta un usuario con un email que ya tiene otro, sin distinguir mayúsculas', async () => {
    const t = createTestApp();
    const { agent: admin } = await loggedInAgent(t);
    insertUser(t.db, { email: 'ana@empresa.com' });
    const before = t.db.select().from(users).all().length;

    const res = await admin.post('/api/users').send({ name: 'Otra Ana', email: 'Ana@Empresa.com', role: 'editor', password: 'clave-segura' });
    expect(res.status).toBe(409);
    expect(t.db.select().from(users).all()).toHaveLength(before);
  });
});

describe('modificación de usuarios (RF-15 a RF-17)', () => {
  it('AC-16: un Admin modifica nombre y email; se ven en el listado y el usuario inicia sesión con el email nuevo', async () => {
    const t = createTestApp();
    const { agent: admin } = await loggedInAgent(t);
    const user = insertUser(t.db, { name: 'Ana', email: 'ana@empresa.com', role: 'editor' });

    const res = await admin.patch(`/api/users/${user.id}`).send({ name: 'Ana María', email: 'anamaria@empresa.com' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Ana María', email: 'anamaria@empresa.com' });

    const list = await admin.get('/api/users');
    expect(list.body).toContainEqual(expect.objectContaining({ id: user.id, name: 'Ana María', email: 'anamaria@empresa.com' }));
    expect((await login(t, 'anamaria@empresa.com', TEST_PASSWORD)).status).toBe(200);
    expect((await login(t, 'ana@empresa.com', TEST_PASSWORD)).status).toBe(401);
  });

  it('AC-15: rechaza modificar un usuario para que tenga el email de otro, sin distinguir mayúsculas, y nada cambia', async () => {
    const t = createTestApp();
    const { agent: admin } = await loggedInAgent(t);
    insertUser(t.db, { email: 'ana@empresa.com' });
    const other = insertUser(t.db, { email: 'beto@empresa.com' });

    const res = await admin.patch(`/api/users/${other.id}`).send({ email: 'Ana@Empresa.com' });
    expect(res.status).toBe(409);
    expect(userRow(t, other.id)?.email).toBe('beto@empresa.com');
  });

  it('un usuario puede conservar su propio email con otras mayúsculas', async () => {
    const t = createTestApp();
    const { agent: admin } = await loggedInAgent(t);
    const user = insertUser(t.db, { email: 'beto@empresa.com' });
    const res = await admin.patch(`/api/users/${user.id}`).send({ email: 'Beto@Empresa.com' });
    expect(res.status).toBe(200);
  });

  it('AC-17: al cambiar el perfil de un Editor a Consulta, su siguiente acción ya se evalúa con el perfil Consulta', async () => {
    const t = createTestApp();
    const { agent: admin } = await loggedInAgent(t, { role: 'admin' });
    const { agent: editor, user } = await loggedInAgent(t, { role: 'editor' });
    expect((await editor.get('/api/auth/me')).body.role).toBe('editor');

    expect((await admin.patch(`/api/users/${user.id}`).send({ role: 'consulta' })).status).toBe(200);
    // Misma sesión, sin volver a iniciar: el perfil se lee de la base en cada solicitud.
    expect((await editor.get('/api/auth/me')).body.role).toBe('consulta');
  });
});

describe('baja y reactivación (RF-18 a RF-20)', () => {
  it('AC-18: al dar de baja a un usuario Activo, pasa a Inactivo y ya no puede iniciar sesión', async () => {
    const t = createTestApp();
    const { agent: admin } = await loggedInAgent(t);
    const user = insertUser(t.db, { email: 'baja@empresa.com', role: 'editor' });

    const res = await admin.post(`/api/users/${user.id}/deactivate`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('inactivo');
    expect(userRow(t, user.id)?.status).toBe('inactivo');
    expect((await login(t, 'baja@empresa.com', TEST_PASSWORD)).status).toBe(401);
  });

  it('AC-19: al reactivar a un usuario Inactivo, pasa a Activo y puede iniciar sesión', async () => {
    const t = createTestApp();
    const { agent: admin } = await loggedInAgent(t);
    const user = insertUser(t.db, { email: 'vuelve@empresa.com', role: 'consulta', status: 'inactivo' });

    const res = await admin.post(`/api/users/${user.id}/reactivate`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('activo');
    expect((await login(t, 'vuelve@empresa.com', TEST_PASSWORD)).status).toBe(200);
  });

  it('AC-20: con un único Admin Activo, rechaza darlo de baja o cambiarle el perfil, y sigue Activo y Admin', async () => {
    const t = createTestApp();
    const { agent: admin, user } = await loggedInAgent(t, { role: 'admin' });
    // Un Admin Inactivo no cuenta como Admin Activo.
    insertUser(t.db, { role: 'admin', status: 'inactivo' });

    const deactivate = await admin.post(`/api/users/${user.id}/deactivate`);
    expect(deactivate.status).toBe(422);
    const demote = await admin.patch(`/api/users/${user.id}`).send({ role: 'editor' });
    expect(demote.status).toBe(422);
    expect(userRow(t, user.id)).toMatchObject({ status: 'activo', role: 'admin' });
  });

  it('AC-20: con dos Admins Activos, la baja de uno de ellos se realiza', async () => {
    const t = createTestApp();
    const { agent: admin } = await loggedInAgent(t, { role: 'admin' });
    const other = insertUser(t.db, { role: 'admin' });

    const res = await admin.post(`/api/users/${other.id}/deactivate`);
    expect(res.status).toBe(200);
    expect(userRow(t, other.id)?.status).toBe('inactivo');
  });

  it('responde 404 para un usuario inexistente', async () => {
    const t = createTestApp();
    const { agent: admin } = await loggedInAgent(t);
    expect((await admin.patch('/api/users/9999').send({ name: 'X' })).status).toBe(404);
    expect((await admin.post('/api/users/9999/deactivate')).status).toBe(404);
  });
});

describe('listado de usuarios y datos de usuarios (RF-07, RF-161)', () => {
  it('AC-168: un Admin ve los usuarios Activos e Inactivos con nombre, email, perfil y estado', async () => {
    const t = createTestApp();
    const { agent: admin } = await loggedInAgent(t, { name: 'Javier', email: 'javier@empresa.com' });
    insertUser(t.db, { name: 'Ana', email: 'ana@empresa.com', role: 'editor', status: 'activo' });
    insertUser(t.db, { name: 'Beto', email: 'beto@empresa.com', role: 'consulta', status: 'inactivo' });

    const res = await admin.get('/api/users');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Ana', email: 'ana@empresa.com', role: 'editor', status: 'activo' }),
        expect.objectContaining({ name: 'Beto', email: 'beto@empresa.com', role: 'consulta', status: 'inactivo' }),
      ]),
    );
    expect(res.body).toHaveLength(3);
  });

  it('AC-05, RF-07: ninguna respuesta con datos de usuarios incluye el hash de la contraseña', async () => {
    const t = createTestApp();
    const { agent: admin } = await loggedInAgent(t);
    const user = insertUser(t.db, { role: 'editor' });

    const responses = [
      await admin.get('/api/users'),
      await admin.post('/api/users').send({ name: 'Nuevo', email: 'nuevo@empresa.com', role: 'editor', password: 'clave-segura' }),
      await admin.patch(`/api/users/${user.id}`).send({ name: 'Otro nombre' }),
      await admin.post(`/api/users/${user.id}/deactivate`),
      await admin.post(`/api/users/${user.id}/reactivate`),
      await admin.get('/api/auth/me'),
    ];
    for (const res of responses) {
      expect(res.status).toBeLessThan(300);
      expect(JSON.stringify(res.body)).not.toMatch(/password|\$2[aby]\$/i);
    }
  });
});

describe('acceso a la gestión de usuarios (RF-09 a RF-11)', () => {
  it('AC-213: un Editor o un usuario Consulta no puede ver el listado de usuarios y no recibe datos de usuarios', async () => {
    const t = createTestApp();
    insertUser(t.db, { name: 'Ana', email: 'ana@empresa.com' });
    for (const role of ['editor', 'consulta'] as const) {
      const { agent } = await loggedInAgent(t, { role });
      const res = await agent.get('/api/users');
      expect(res.status, role).toBe(403);
      expect(JSON.stringify(res.body), role).not.toContain('ana@empresa.com');
    }
  });

  it('AC-214: un Editor no puede crear, modificar, dar de baja ni reactivar usuarios, y nada cambia', async () => {
    const t = createTestApp();
    const { agent: editor } = await loggedInAgent(t, { role: 'editor' });
    const target = insertUser(t.db, { name: 'Ana', email: 'ana@empresa.com', role: 'consulta' });
    const inactive = insertUser(t.db, { role: 'consulta', status: 'inactivo' });
    const before = t.db.select().from(users).all();

    const attempts = [
      await editor.post('/api/users').send({ name: 'X', email: 'x@empresa.com', role: 'admin', password: 'clave-segura' }),
      await editor.patch(`/api/users/${target.id}`).send({ role: 'admin' }),
      await editor.post(`/api/users/${target.id}/deactivate`),
      await editor.post(`/api/users/${inactive.id}/reactivate`),
    ];
    for (const res of attempts) expect(res.status).toBe(403);
    expect(t.db.select().from(users).all()).toEqual(before);
  });

  it('RF-13: un usuario Consulta tampoco puede gestionar usuarios', async () => {
    const t = createTestApp();
    const { agent: consulta } = await loggedInAgent(t, { role: 'consulta' });
    const res = await consulta.post('/api/users').send({ name: 'X', email: 'x@empresa.com', role: 'admin', password: 'clave-segura' });
    expect(res.status).toBe(403);
  });
});
