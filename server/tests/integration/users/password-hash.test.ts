import { eq } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { users } from '../../../src/db/schema.ts';
import { createTestApp, loggedInAgent, type TestApp } from '../../helpers/test-app.ts';
import { insertUser, TEST_PASSWORD } from '../../helpers/test-db.ts';

const BCRYPT = /^\$2[aby]\$(\d{2})\$[./A-Za-z0-9]{53}$/;

const storedHash = (t: TestApp, email: string) =>
  t.db.select({ hash: users.passwordHash }).from(users).where(eq(users.emailNormalized, email)).get()?.hash ?? '';

/** RNF-09: hash bcrypt con costo ≥ 12 que no contiene la contraseña en texto plano. */
function expectSecureHash(hash: string, password: string) {
  const match = BCRYPT.exec(hash);
  expect(match, `"${hash}" no es un hash bcrypt`).not.toBeNull();
  expect(Number(match?.[1])).toBeGreaterThanOrEqual(12);
  expect(hash).not.toContain(password);
}

describe('contraseñas guardadas con hash seguro (RNF-09)', () => {
  it('AC-224: el primer Admin registrado queda con hash bcrypt de costo ≥ 12', async () => {
    const t = createTestApp();
    await request(t.app)
      .post('/api/setup/first-admin')
      .send({ name: 'Javier', email: 'javier@empresa.com', password: 'clave-primer-admin' });
    expectSecureHash(storedHash(t, 'javier@empresa.com'), 'clave-primer-admin');
  });

  it('AC-224: un usuario dado de alta por un Admin queda con hash bcrypt de costo ≥ 12', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    await agent.post('/api/users').send({ name: 'Ana', email: 'ana@empresa.com', role: 'editor', password: 'clave-de-ana' });
    expectSecureHash(storedHash(t, 'ana@empresa.com'), 'clave-de-ana');
  });

  it('AC-224: la contraseña cambiada desde el perfil queda con hash bcrypt de costo ≥ 12', async () => {
    const t = createTestApp();
    const { agent, user } = await loggedInAgent(t);
    await agent.post('/api/auth/password').send({ currentPassword: TEST_PASSWORD, newPassword: 'clave-cambiada' });
    expectSecureHash(storedHash(t, user.emailNormalized), 'clave-cambiada');
  });

  it('AC-224: la contraseña restablecida con un token de recuperación queda con hash bcrypt de costo ≥ 12', async () => {
    const t = createTestApp();
    insertUser(t.db, { email: 'ana@empresa.com' });
    await request(t.app).post('/api/auth/recovery').send({ email: 'ana@empresa.com' });
    const token = /\/restablecer-contrasena\/([A-Za-z0-9_-]+)/.exec(t.adapters.mailSender.sent.at(-1)?.text ?? '')?.[1];
    await request(t.app).post(`/api/auth/recovery/${token}`).send({ newPassword: 'clave-restablecida' });
    expectSecureHash(storedHash(t, 'ana@empresa.com'), 'clave-restablecida');
  });

  it('dos usuarios con la misma contraseña quedan con hashes distintos (sal aleatoria)', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    await agent.post('/api/users').send({ name: 'Ana', email: 'ana@empresa.com', role: 'editor', password: 'misma-clave' });
    await agent.post('/api/users').send({ name: 'Beto', email: 'beto@empresa.com', role: 'editor', password: 'misma-clave' });
    expect(storedHash(t, 'ana@empresa.com')).not.toBe(storedHash(t, 'beto@empresa.com'));
  });
});
