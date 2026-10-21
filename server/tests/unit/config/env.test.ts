import { describe, expect, it } from 'vitest';
import { EnvError, loadEnv } from '../../../src/config/env.ts';

const root = '/repo';

// Valores de prueba: ningún test usa credenciales reales (AGENTS.md).
const realEnv = {
  ANTHROPIC_API_KEY: 'valor-de-prueba-anthropic',
  GMAIL_USER: 'sistema@empresa.com',
  GMAIL_APP_PASSWORD: 'valor-de-prueba-gmail',
  ARCA_CUIT: '30711111111',
  ARCA_CERT_PATH: 'certs/test.crt',
  ARCA_KEY_PATH: 'certs/test.key',
};

function errorOf(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error('se esperaba un error');
}

describe('loadEnv en modo mock (RF-205 a RF-207)', () => {
  it('RF-205: arranca con MOCK_MODE como única variable definida', () => {
    const env = loadEnv({ MOCK_MODE: 'true' }, root);
    expect(env.mode).toBe('mock');
    expect(env.databasePath).toBe('/repo/data/aldebaran-mock.db');
    expect(env.anthropicApiKey).toBeNull();
    expect(env.gmailUser).toBeNull();
  });

  it('AC-205, RF-206: sin ARCA_CUIT usa 20111111112 como CUIT del emisor; con ARCA_CUIT usa ese valor', () => {
    expect(loadEnv({ MOCK_MODE: 'true' }, root).arcaCuit).toBe('20111111112');
    expect(loadEnv({ MOCK_MODE: 'true', ARCA_CUIT: '30711111111' }, root).arcaCuit).toBe('30711111111');
  });

  it('RF-207: sin SCHEDULER_ENABLED ejecuta los procesos automáticos; definida, solo con "true"', () => {
    expect(loadEnv({ MOCK_MODE: 'true' }, root).schedulerEnabled).toBe(true);
    expect(loadEnv({ MOCK_MODE: 'true', SCHEDULER_ENABLED: 'true' }, root).schedulerEnabled).toBe(true);
    expect(loadEnv({ MOCK_MODE: 'true', SCHEDULER_ENABLED: 'false' }, root).schedulerEnabled).toBe(false);
  });
});

describe('loadEnv fuera del modo mock', () => {
  it('AC-226, AC-227: toma la API key, la casilla y las credenciales de ARCA de las variables de entorno', () => {
    const env = loadEnv(realEnv, root);
    expect(env.mode).toBe('homologacion');
    expect(env.anthropicApiKey).toBe(realEnv.ANTHROPIC_API_KEY);
    expect(env.gmailUser).toBe(realEnv.GMAIL_USER);
    expect(env.gmailAppPassword).toBe(realEnv.GMAIL_APP_PASSWORD);
    expect(env.arcaCuit).toBe(realEnv.ARCA_CUIT);
    expect(env.arcaCertPath).toBe('/repo/certs/test.crt');
    expect(env.arcaKeyPath).toBe('/repo/certs/test.key');
  });

  it('SCHEDULER_ENABLED solo vale con "true"; sin la variable los procesos quedan apagados (AGENTS.md)', () => {
    expect(loadEnv(realEnv, root).schedulerEnabled).toBe(false);
    expect(loadEnv({ ...realEnv, SCHEDULER_ENABLED: 'TRUE' }, root).schedulerEnabled).toBe(false);
    expect(loadEnv({ ...realEnv, SCHEDULER_ENABLED: 'true' }, root).schedulerEnabled).toBe(true);
  });

  it('exige cada credencial y el error nombra las faltantes', () => {
    for (const name of Object.keys(realEnv)) {
      const partial: Record<string, string> = { ...realEnv };
      delete partial[name];
      const error = errorOf(() => loadEnv(partial, root));
      expect(error).toBeInstanceOf(EnvError);
      expect(error.message).toContain(name);
    }
  });

  it('Constitución IV: los mensajes de error no muestran valores de secretos', () => {
    const { ARCA_KEY_PATH: _omit, ...partial } = realEnv;
    const message = errorOf(() => loadEnv(partial, root)).message;
    expect(message).not.toContain(realEnv.ANTHROPIC_API_KEY);
    expect(message).not.toContain(realEnv.GMAIL_APP_PASSWORD);
    expect(message).not.toContain(realEnv.GMAIL_USER);
  });

  it('RF-213: la configuración de base inválida también impide arrancar', () => {
    expect(() => loadEnv({ ...realEnv, DATABASE_PATH: 'data/aldebaran-mock.db' }, root)).toThrow();
  });
});

describe('variables opcionales', () => {
  it('RF-24: APP_URL por defecto es http://localhost:5173 y se normaliza sin barra final', () => {
    expect(loadEnv(realEnv, root).appUrl).toBe('http://localhost:5173');
    expect(loadEnv({ ...realEnv, APP_URL: 'https://aldebaran.empresa.com/' }, root).appUrl).toBe(
      'https://aldebaran.empresa.com',
    );
  });

  it('PORT por defecto es 3000 y EMAIL_REDIRECT_TO es null si no está definida', () => {
    expect(loadEnv(realEnv, root).port).toBe(3000);
    expect(loadEnv({ ...realEnv, PORT: '4000' }, root).port).toBe(4000);
    expect(loadEnv(realEnv, root).emailRedirectTo).toBeNull();
    expect(loadEnv({ ...realEnv, EMAIL_REDIRECT_TO: 'dev@empresa.com' }, root).emailRedirectTo).toBe('dev@empresa.com');
  });
});
