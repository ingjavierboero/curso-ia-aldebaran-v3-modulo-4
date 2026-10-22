/**
 * App Express real sobre una base en memoria y los adapters fake, para los tests de API con supertest.
 * Ningún test llama a servicios reales (AGENTS.md).
 */
import request from 'supertest';
import { createApp } from '../../src/app.ts';
import type { Env } from '../../src/config/env.ts';
import type { AppContext } from '../../src/context.ts';
import { createFakeAdapters } from './fakes.ts';
import { createTestDb, insertUser, TEST_PASSWORD } from './test-db.ts';

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    mode: 'homologacion',
    port: 0,
    appUrl: 'http://localhost:5173',
    databasePath: ':memory:',
    schedulerEnabled: false,
    emailRedirectTo: null,
    anthropicApiKey: 'valor-de-prueba',
    gmailUser: 'sistema@aldebaran.test',
    gmailAppPassword: 'valor-de-prueba',
    arcaCuit: '20111111112',
    arcaCertPath: null,
    arcaKeyPath: null,
    ...overrides,
  };
}

export function createTestApp(options: { now?: string | Date; env?: Partial<Env> } = {}) {
  const db = createTestDb();
  const adapters = createFakeAdapters(options.now);
  const env = testEnv(options.env);
  const ctx: AppContext = { db, env, adapters };
  const app = createApp(ctx, { log: () => {} });
  return { app, db, env, adapters, ctx };
}

export type TestApp = ReturnType<typeof createTestApp>;

/** Agente de supertest que conserva la cookie de sesión entre solicitudes. */
export function agent(testApp: TestApp) {
  return request.agent(testApp.app);
}

/** Crea un usuario y devuelve un agente con su sesión iniciada. */
export async function loggedInAgent(
  testApp: TestApp,
  overrides: Parameters<typeof insertUser>[1] = {},
) {
  const user = insertUser(testApp.db, overrides);
  const client = agent(testApp);
  const response = await client.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD });
  if (response.status !== 200) throw new Error(`No se pudo iniciar sesión en el test: HTTP ${response.status}`);
  return { agent: client, user };
}
