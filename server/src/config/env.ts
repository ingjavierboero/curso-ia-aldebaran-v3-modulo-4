import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { type Mode, type RawEnv, resolveDatabasePath, resolveFromRoot, resolveMode } from './mode.ts';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** CUIT del emisor en modo mock cuando ARCA_CUIT no está definida (RF-206). */
export const MOCK_ARCA_CUIT = '20111111112';

const REQUIRED_OUTSIDE_MOCK = [
  'ANTHROPIC_API_KEY',
  'GMAIL_USER',
  'GMAIL_APP_PASSWORD',
  'ARCA_CUIT',
  'ARCA_CERT_PATH',
  'ARCA_KEY_PATH',
] as const;

export interface Env {
  mode: Mode;
  port: number;
  appUrl: string;
  databasePath: string;
  schedulerEnabled: boolean;
  emailRedirectTo: string | null;
  anthropicApiKey: string | null;
  gmailUser: string | null;
  gmailAppPassword: string | null;
  arcaCuit: string;
  arcaCertPath: string | null;
  arcaKeyPath: string | null;
}

/** Configuración inválida. Nombra las variables, nunca muestra sus valores (Constitución IV). */
export class EnvError extends Error {}

// Una variable vacía o con solo espacios cuenta como no definida.
const optional = z
  .string()
  .optional()
  .transform((value) => value?.trim() || null);

const schema = z.object({
  PORT: optional
    .transform((value) => (value === null ? null : Number(value)))
    .pipe(z.number().int().min(1).max(65535).nullable()),
  APP_URL: optional.pipe(z.url().nullable()),
  ARCA_CUIT: optional.pipe(z.string().regex(/^\d{11}$/).nullable()),
  ANTHROPIC_API_KEY: optional,
  GMAIL_USER: optional,
  GMAIL_APP_PASSWORD: optional,
  ARCA_CERT_PATH: optional,
  ARCA_KEY_PATH: optional,
  EMAIL_REDIRECT_TO: optional,
  SCHEDULER_ENABLED: z.string().optional(),
});

export function loadEnv(raw: RawEnv = process.env, repoRoot: string = REPO_ROOT): Env {
  const mode = resolveMode(raw);

  if (mode === 'homologacion') {
    const missing = REQUIRED_OUTSIDE_MOCK.filter((name) => !raw[name]?.trim());
    if (missing.length > 0) {
      throw new EnvError(`Faltan variables de entorno obligatorias fuera del modo mock: ${missing.join(', ')}.`);
    }
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
    throw new EnvError(`Variables de entorno con valores inválidos: ${names.join(', ')}.`);
  }
  const env = parsed.data;

  return {
    mode,
    port: env.PORT ?? 3000,
    appUrl: (env.APP_URL ?? 'http://localhost:5173').replace(/\/+$/, ''),
    databasePath: resolveDatabasePath(mode, raw, repoRoot),
    // RF-207: en mock, si SCHEDULER_ENABLED no está definida, los procesos automáticos corren.
    schedulerEnabled:
      mode === 'mock' && env.SCHEDULER_ENABLED === undefined ? true : env.SCHEDULER_ENABLED === 'true',
    emailRedirectTo: env.EMAIL_REDIRECT_TO,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    gmailUser: env.GMAIL_USER,
    gmailAppPassword: env.GMAIL_APP_PASSWORD,
    arcaCuit: env.ARCA_CUIT ?? MOCK_ARCA_CUIT,
    arcaCertPath: env.ARCA_CERT_PATH ? resolveFromRoot(env.ARCA_CERT_PATH, repoRoot) : null,
    arcaKeyPath: env.ARCA_KEY_PATH ? resolveFromRoot(env.ARCA_KEY_PATH, repoRoot) : null,
  };
}
