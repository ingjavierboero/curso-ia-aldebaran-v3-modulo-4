import { eq } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { users } from '../../src/db/schema.ts';
import { createTestApp, type TestApp } from '../helpers/test-app.ts';
import { insertUser, TEST_PASSWORD } from '../helpers/test-db.ts';

const MINUTE = 60 * 1000;
const LINK = /(https?:\/\/[^\s]+)\/restablecer-contrasena\/([A-Za-z0-9_-]+)/;

const askRecovery = (t: TestApp, email: string) => request(t.app).post('/api/auth/recovery').send({ email });

/** Último link de recuperación enviado por email: su base y su token. */
function lastLink(t: TestApp) {
  const match = LINK.exec(t.adapters.mailSender.sent.at(-1)?.text ?? '');
  if (!match) throw new Error('No se envió ningún email con el link de recuperación');
  return { base: match[1], token: match[2] as string };
}

const checkToken = (t: TestApp, token: string) => request(t.app).get(`/api/auth/recovery/${token}`);
const confirm = (t: TestApp, token: string, newPassword: string) =>
  request(t.app).post(`/api/auth/recovery/${token}`).send({ newPassword });
const login = (t: TestApp, email: string, password: string) =>
  request(t.app).post('/api/auth/login').send({ email, password });
const passwordHash = (t: TestApp, id: number) =>
  t.db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, id)).get()?.hash;

describe('solicitud de recuperación (RF-23 a RF-25)', () => {
  it('AC-26: un usuario Activo recibe un email con una URL que contiene un token de recuperación', async () => {
    const t = createTestApp();
    insertUser(t.db, { email: 'ana@empresa.com' });

    const res = await askRecovery(t, 'ana@empresa.com');
    expect(res.status).toBe(200);
    expect(t.adapters.mailSender.sent).toHaveLength(1);
    expect(t.adapters.mailSender.sent[0]?.to).toBe('ana@empresa.com');
    expect(lastLink(t).token.length).toBeGreaterThanOrEqual(32);
  });

  it('el email del pedido no distingue mayúsculas', async () => {
    const t = createTestApp();
    insertUser(t.db, { email: 'ana@empresa.com' });
    await askRecovery(t, 'Ana@Empresa.com');
    expect(t.adapters.mailSender.sent[0]?.to).toBe('ana@empresa.com');
  });

  it('AC-27, RF-25: para un email desconocido o de un usuario Inactivo responde el mismo mensaje y no envía ningún email', async () => {
    const t = createTestApp();
    insertUser(t.db, { email: 'ana@empresa.com' });
    insertUser(t.db, { email: 'baja@empresa.com', status: 'inactivo' });

    const known = await askRecovery(t, 'ana@empresa.com');
    const unknown = await askRecovery(t, 'nadie@empresa.com');
    const inactive = await askRecovery(t, 'baja@empresa.com');

    expect(unknown.status).toBe(known.status);
    expect(inactive.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
    expect(inactive.body).toEqual(known.body);
    expect(t.adapters.mailSender.sent).toHaveLength(1);
  });

  it('AC-251, RF-24: la URL usa APP_URL aunque la solicitud llegue con otro header Host', async () => {
    const t = createTestApp({ env: { appUrl: 'https://aldebaran.empresa.com' } });
    insertUser(t.db, { email: 'ana@empresa.com' });
    await request(t.app).post('/api/auth/recovery').set('Host', 'otro-sitio.com').send({ email: 'ana@empresa.com' });
    expect(lastLink(t).base).toBe('https://aldebaran.empresa.com');
  });

  it('AC-251: sin APP_URL definida, la URL empieza con http://localhost:5173', async () => {
    const t = createTestApp(); // testEnv usa el valor por defecto de APP_URL
    insertUser(t.db, { email: 'ana@empresa.com' });
    await request(t.app).post('/api/auth/recovery').set('Host', 'otro-sitio.com').send({ email: 'ana@empresa.com' });
    expect(lastLink(t).base).toBe('http://localhost:5173');
  });
});

describe('validación del token al ingresar a la URL (RF-26, RF-29, RF-30, RF-32)', () => {
  it('AC-28: un token sin usar enviado hace 9 minutos es válido y muestra la pantalla de cambio de contraseña', async () => {
    const t = createTestApp({ now: '2026-10-20T12:00:00Z' });
    insertUser(t.db, { email: 'ana@empresa.com' });
    await askRecovery(t, 'ana@empresa.com');

    t.adapters.clock.advance(9 * MINUTE);
    const res = await checkToken(t, lastLink(t).token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: true });
  });

  it('AC-29, RF-26: a los 10 minutos del envío el token ya no es válido', async () => {
    const t = createTestApp({ now: '2026-10-20T12:00:00Z' });
    insertUser(t.db, { email: 'ana@empresa.com' });
    await askRecovery(t, 'ana@empresa.com');
    const { token } = lastLink(t);

    t.adapters.clock.advance(10 * MINUTE);
    const res = await checkToken(t, token);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('token_invalido');
  });

  it('RF-30: un token inexistente no es válido', async () => {
    const t = createTestApp();
    const res = await checkToken(t, 'token-que-no-existe');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('token_invalido');
  });

  it('AC-31, RF-28: al pedir la recuperación dos veces, el link del primer email deja de valer y el del segundo vale', async () => {
    const t = createTestApp();
    insertUser(t.db, { email: 'ana@empresa.com' });
    await askRecovery(t, 'ana@empresa.com');
    const first = lastLink(t).token;
    await askRecovery(t, 'ana@empresa.com');
    const second = lastLink(t).token;

    expect(first).not.toBe(second);
    expect((await checkToken(t, first)).status).toBe(400);
    expect((await checkToken(t, second)).status).toBe(200);
  });
});

describe('confirmación de la nueva contraseña (RF-27, RF-29, RF-33)', () => {
  it('AC-33: con un token válido, la contraseña queda cambiada y el usuario inicia sesión con la nueva', async () => {
    const t = createTestApp();
    insertUser(t.db, { email: 'ana@empresa.com' });
    await askRecovery(t, 'ana@empresa.com');

    const res = await confirm(t, lastLink(t).token, 'clave-nueva-123');
    expect(res.status).toBe(204);
    expect((await login(t, 'ana@empresa.com', 'clave-nueva-123')).status).toBe(200);
    expect((await login(t, 'ana@empresa.com', TEST_PASSWORD)).status).toBe(401);
  });

  it('AC-30, RF-27: un token ya usado para cambiar la contraseña deja de ser válido', async () => {
    const t = createTestApp();
    insertUser(t.db, { email: 'ana@empresa.com' });
    await askRecovery(t, 'ana@empresa.com');
    const { token } = lastLink(t);

    expect((await confirm(t, token, 'clave-nueva-123')).status).toBe(204);
    expect((await checkToken(t, token)).status).toBe(400);
    expect((await confirm(t, token, 'otra-clave-456')).status).toBe(400);
    expect((await login(t, 'ana@empresa.com', 'clave-nueva-123')).status).toBe(200);
  });

  it('AC-32, RF-29: si el token vence entre que se abre la pantalla y se confirma, rechaza el cambio y la contraseña no cambia', async () => {
    const t = createTestApp({ now: '2026-10-20T12:00:00Z' });
    const user = insertUser(t.db, { email: 'ana@empresa.com' });
    await askRecovery(t, 'ana@empresa.com');
    const { token } = lastLink(t);
    const before = passwordHash(t, user.id);

    t.adapters.clock.advance(5 * MINUTE);
    expect((await checkToken(t, token)).status).toBe(200);
    t.adapters.clock.advance(6 * MINUTE);

    const res = await confirm(t, token, 'clave-nueva-123');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('token_invalido');
    expect(passwordHash(t, user.id)).toBe(before);
  });

  it('un token de un usuario dado de baja después del pedido no permite cambiar la contraseña', async () => {
    const t = createTestApp();
    const user = insertUser(t.db, { email: 'ana@empresa.com' });
    await askRecovery(t, 'ana@empresa.com');
    const { token } = lastLink(t);
    t.db.update(users).set({ status: 'inactivo' }).where(eq(users.id, user.id)).run();

    expect((await confirm(t, token, 'clave-nueva-123')).status).toBe(400);
  });
});
