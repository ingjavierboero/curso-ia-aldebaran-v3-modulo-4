import { eq } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { users } from '../../src/db/schema.ts';
import { agent, createTestApp } from '../helpers/test-app.ts';
import { insertUser, TEST_PASSWORD } from '../helpers/test-db.ts';

describe('registro del primer Admin (RF-04, RF-05)', () => {
  it('AC-03: sin usuarios, la app pide registrar el primer Admin', async () => {
    const t = createTestApp();
    const res = await request(t.app).get('/api/setup');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ needsFirstAdmin: true, mode: 'homologacion', emailRedirectTo: null });
  });

  it('AC-03, RF-22: rechaza el registro con una contraseña de 7 caracteres y no crea el usuario', async () => {
    const t = createTestApp();
    const res = await request(t.app)
      .post('/api/setup/first-admin')
      .send({ name: 'Javier', email: 'javier@empresa.com', password: '1234567' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validacion');
    expect(t.db.select().from(users).all()).toHaveLength(0);
  });

  it('AC-03: con una contraseña de 8 caracteres el usuario queda Activo, con perfil Admin, y puede iniciar sesión', async () => {
    const t = createTestApp();
    const res = await request(t.app)
      .post('/api/setup/first-admin')
      .send({ name: 'Javier', email: 'javier@empresa.com', password: '12345678' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Javier', email: 'javier@empresa.com', role: 'admin', status: 'activo' });
    expect(res.body).not.toHaveProperty('passwordHash');

    const login = await request(t.app).post('/api/auth/login').send({ email: 'javier@empresa.com', password: '12345678' });
    expect(login.status).toBe(200);
    expect((await request(t.app).get('/api/setup')).body.needsFirstAdmin).toBe(false);
  });

  it('AC-212, RF-05: con al menos un usuario, el registro del primer Admin se rechaza y no crea ningún usuario', async () => {
    const t = createTestApp();
    insertUser(t.db);
    const res = await request(t.app)
      .post('/api/setup/first-admin')
      .send({ name: 'Intruso', email: 'intruso@empresa.com', password: '12345678' });
    expect(res.status).toBe(403);
    expect(t.db.select().from(users).all()).toHaveLength(1);
  });
});

describe('inicio y cierre de sesión (RF-02, RF-03)', () => {
  it('AC-01: un usuario Activo inicia sesión con su email y su contraseña y accede al sistema', async () => {
    const t = createTestApp();
    const user = insertUser(t.db, { email: 'ana@empresa.com', role: 'editor' });
    const client = agent(t);

    const login = await client.post('/api/auth/login').send({ email: 'ana@empresa.com', password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body).toMatchObject({ id: user.id, email: 'ana@empresa.com', role: 'editor' });
    expect(login.body).not.toHaveProperty('passwordHash');

    const me = await client.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: user.id, role: 'editor' });
  });

  it('el email del login no distingue mayúsculas (RF-15)', async () => {
    const t = createTestApp();
    insertUser(t.db, { email: 'ana@empresa.com' });
    const login = await request(t.app).post('/api/auth/login').send({ email: 'Ana@Empresa.com', password: TEST_PASSWORD });
    expect(login.status).toBe(200);
  });

  it('AC-01: con una contraseña incorrecta, el sistema rechaza el inicio de sesión', async () => {
    const t = createTestApp();
    insertUser(t.db, { email: 'ana@empresa.com' });
    const client = agent(t);
    const login = await client.post('/api/auth/login').send({ email: 'ana@empresa.com', password: 'incorrecta' });
    expect(login.status).toBe(401);
    expect((await client.get('/api/auth/me')).status).toBe(401);
  });

  it('un email inexistente se rechaza con el mismo mensaje que una contraseña incorrecta', async () => {
    const t = createTestApp();
    insertUser(t.db, { email: 'ana@empresa.com' });
    const wrongPassword = await request(t.app).post('/api/auth/login').send({ email: 'ana@empresa.com', password: 'x' });
    const unknownEmail = await request(t.app).post('/api/auth/login').send({ email: 'nadie@empresa.com', password: 'x' });
    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message);
  });

  it('AC-18, RF-02: un usuario Inactivo no puede iniciar sesión', async () => {
    const t = createTestApp();
    insertUser(t.db, { email: 'baja@empresa.com', status: 'inactivo' });
    const login = await request(t.app).post('/api/auth/login').send({ email: 'baja@empresa.com', password: TEST_PASSWORD });
    expect(login.status).toBe(401);
  });

  it('AC-19: un usuario reactivado vuelve a poder iniciar sesión', async () => {
    const t = createTestApp();
    const user = insertUser(t.db, { email: 'vuelve@empresa.com', status: 'inactivo' });
    t.db.update(users).set({ status: 'activo' }).where(eq(users.id, user.id)).run();
    const login = await request(t.app).post('/api/auth/login').send({ email: 'vuelve@empresa.com', password: TEST_PASSWORD });
    expect(login.status).toBe(200);
  });

  it('AC-02: al cerrar la sesión, el sistema rechaza cualquier solicitud posterior hecha con esa sesión', async () => {
    const t = createTestApp();
    const user = insertUser(t.db);
    const client = agent(t);
    const login = await client.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD });
    const cookie = String(login.headers['set-cookie']).split(';')[0] ?? '';

    const logout = await client.post('/api/auth/logout');
    expect(logout.status).toBe(204);
    expect((await client.get('/api/auth/me')).status).toBe(401);
    // Aunque se reenvíe la cookie anterior, la sesión ya no existe.
    expect((await request(t.app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
  });

  it('la cookie de sesión es HttpOnly y SameSite=Lax (research R-10)', async () => {
    const t = createTestApp();
    const user = insertUser(t.db);
    const login = await request(t.app).post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD });
    const cookie = String(login.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });
});

describe('acceso sin sesión (RF-01)', () => {
  const protectedRequests: Array<[method: 'get' | 'post' | 'put' | 'patch', path: string]> = [
    ['get', '/api/auth/me'],
    ['post', '/api/auth/logout'],
    ['post', '/api/auth/password'],
    ['get', '/api/users'],
    ['get', '/api/clients'],
    ['get', '/api/products'],
    ['get', '/api/invoices'],
    ['get', '/api/dashboard'],
    ['get', '/api/settings'],
    ['put', '/api/settings'],
    ['get', '/api/review/payments'],
    ['get', '/api/reports/billing'],
    ['get', '/api/mock-mailbox'],
    ['get', '/api/ruta-que-no-existe'],
  ];

  it('AC-211: rechaza cualquier pantalla o endpoint no público sin sesión y no devuelve ningún dato', async () => {
    const t = createTestApp();
    insertUser(t.db);
    for (const [method, path] of protectedRequests) {
      const res = await request(t.app)[method](path);
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(401);
      expect(Object.keys(res.body), `${method.toUpperCase()} ${path}`).toEqual(['error']);
    }
  });

  it('AC-211: los endpoints públicos responden sin sesión', async () => {
    const t = createTestApp();
    insertUser(t.db, { email: 'ana@empresa.com' });
    expect((await request(t.app).get('/api/setup')).status).toBe(200);
    expect((await request(t.app).post('/api/auth/login').send({ email: 'x@y.com', password: 'x' })).status).toBe(401);
    // La recuperación de contraseña es pública: responde aunque no haya sesión (su lógica se prueba en T042).
    expect((await request(t.app).post('/api/auth/recovery').send({ email: 'ana@empresa.com' })).status).not.toBe(401);
  });

  it('una cookie de sesión inventada se rechaza', async () => {
    const t = createTestApp();
    insertUser(t.db);
    const res = await request(t.app).get('/api/auth/me').set('Cookie', 'aldebaran_session=token-inventado');
    expect(res.status).toBe(401);
  });
});
