/**
 * App Express real sobre una base en memoria y los adapters fake, para los tests de API con supertest.
 * Ningún test llama a servicios reales (AGENTS.md).
 */
import request from 'supertest';
import { createAdapters } from '../../src/adapters/index.ts';
import { createApp } from '../../src/app.ts';
import { type Env, loadEnv } from '../../src/config/env.ts';
import type { AppContext } from '../../src/context.ts';
import { createFakeAdapters, FakeFx, fixedClock } from './fakes.ts';
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

/**
 * App en modo mock con los adapters reales del modo mock (ARCA, LLM y casilla simulados) sobre una base
 * en memoria, como la arma `index.ts` con MOCK_MODE=true. Solo la cotización es un fake, para no salir a
 * internet (AGENTS.md).
 */
export function createMockTestApp(options: { now?: string | Date; raw?: Record<string, string> } = {}) {
  const db = createTestDb();
  const clock = fixedClock(options.now ?? '2026-10-15T14:00:00Z');
  const env = loadEnv({ MOCK_MODE: 'true', ...options.raw });
  const adapters = { ...createAdapters(env, db, clock), clock, fx: new FakeFx() };
  const ctx: AppContext = { db, env, adapters };
  const app = createApp(ctx, { log: () => {} });
  return { app, db, env, adapters, ctx };
}

/** Lo que necesitan los helpers de sesión: la app y su base. */
type AppWithDb = Pick<TestApp, 'app' | 'db'>;

/** Agente de supertest que conserva la cookie de sesión entre solicitudes. */
export function agent(testApp: AppWithDb) {
  return request.agent(testApp.app);
}

/** Crea un usuario y devuelve un agente con su sesión iniciada. */
export async function loggedInAgent(
  testApp: AppWithDb,
  overrides: Parameters<typeof insertUser>[1] = {},
) {
  const user = insertUser(testApp.db, overrides);
  const client = agent(testApp);
  const response = await client.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD });
  if (response.status !== 200) throw new Error(`No se pudo iniciar sesión en el test: HTTP ${response.status}`);
  return { agent: client, user };
}
