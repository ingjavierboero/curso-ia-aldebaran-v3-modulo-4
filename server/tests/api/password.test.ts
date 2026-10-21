import { eq } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { users } from '../../src/db/schema.ts';
import { createTestApp, loggedInAgent, type TestApp } from '../helpers/test-app.ts';
import { insertUser, TEST_PASSWORD } from '../helpers/test-db.ts';

const login = (t: TestApp, email: string, password: string) =>
  request(t.app).post('/api/auth/login').send({ email, password });

const passwordHash = (t: TestApp, id: number) =>
  t.db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, id)).get()?.hash;

/** Pide la recuperación y devuelve el token del link que llegó por email (RF-24). */
async function recoveryToken(t: TestApp, email: string): Promise<string> {
  await request(t.app).post('/api/auth/recovery').send({ email });
  const text = t.adapters.mailSender.sent.at(-1)?.text ?? '';
  const token = /\/restablecer-contrasena\/([A-Za-z0-9_-]+)/.exec(text)?.[1];
  if (!token) throw new Error('El email de recuperación no trae el link con el token');
  return token;
}

describe('cambio de la propia contraseña desde el perfil (RF-21)', () => {
  it('AC-21: con la contraseña actual correcta, el usuario de cualquier perfil inicia sesión con la nueva y no con la anterior', async () => {
    const t = createTestApp();
    for (const role of ['admin', 'editor', 'consulta'] as const) {
      const { agent, user } = await loggedInAgent(t, { role });
      const res = await agent.post('/api/auth/password').send({ currentPassword: TEST_PASSWORD, newPassword: 'clave-nueva-123' });
      expect(res.status, role).toBe(204);
      expect((await login(t, user.email, 'clave-nueva-123')).status, role).toBe(200);
      expect((await login(t, user.email, TEST_PASSWORD)).status, role).toBe(401);
    }
  });

  it('AC-22: con una contraseña actual incorrecta, rechaza el cambio y la contraseña no cambia', async () => {
    const t = createTestApp();
    const { agent, user } = await loggedInAgent(t);
    const before = passwordHash(t, user.id);

    const res = await agent.post('/api/auth/password').send({ currentPassword: 'incorrecta', newPassword: 'clave-nueva-123' });
    expect(res.status).toBe(400);
    expect(passwordHash(t, user.id)).toBe(before);
    expect((await login(t, user.email, TEST_PASSWORD)).status).toBe(200);
  });

  it('AC-218: no permite cambiar la contraseña de otro usuario aunque la solicitud lo indique', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const other = insertUser(t.db, { role: 'editor' });
    const before = passwordHash(t, other.id);

    const res = await agent
      .post('/api/auth/password')
      .send({ userId: other.id, currentPassword: TEST_PASSWORD, newPassword: 'clave-nueva-123' });
    expect(res.status).toBe(400);
    expect(passwordHash(t, other.id)).toBe(before);
    expect((await login(t, other.email, TEST_PASSWORD)).status).toBe(200);
  });
});

describe('mínimo de 8 caracteres en todas las vías (RF-22)', () => {
  it('AC-23: desde el perfil, una contraseña de 7 caracteres se rechaza y no cambia; una de 8 se guarda', async () => {
    const t = createTestApp();
    const { agent, user } = await loggedInAgent(t);
    const before = passwordHash(t, user.id);

    const short = await agent.post('/api/auth/password').send({ currentPassword: TEST_PASSWORD, newPassword: '1234567' });
    expect(short.status).toBe(400);
    expect(passwordHash(t, user.id)).toBe(before);

    const ok = await agent.post('/api/auth/password').send({ currentPassword: TEST_PASSWORD, newPassword: '12345678' });
    expect(ok.status).toBe(204);
    expect((await login(t, user.email, '12345678')).status).toBe(200);
  });

  it('AC-24: un Admin no puede dar de alta un usuario con una contraseña de 7 caracteres', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const res = await agent.post('/api/users').send({ name: 'Ana', email: 'ana@empresa.com', role: 'editor', password: '1234567' });
    expect(res.status).toBe(400);
    expect(t.db.select().from(users).where(eq(users.emailNormalized, 'ana@empresa.com')).get()).toBeUndefined();
  });

  it('AC-25: con un token de recuperación válido, una nueva contraseña de 7 caracteres se rechaza y no cambia', async () => {
    const t = createTestApp();
    const user = insertUser(t.db, { email: 'ana@empresa.com' });
    const before = passwordHash(t, user.id);
    const token = await recoveryToken(t, 'ana@empresa.com');

    const res = await request(t.app).post(`/api/auth/recovery/${token}`).send({ newPassword: '1234567' });
    expect(res.status).toBe(400);
    expect(passwordHash(t, user.id)).toBe(before);
    // El token sigue sirviendo para un intento válido.
    expect((await request(t.app).post(`/api/auth/recovery/${token}`).send({ newPassword: '12345678' })).status).toBe(204);
  });
});
