import { isAbsolute, resolve } from 'node:path';

/** Modos del MVP (Constitución, Principio V). El modo producción no existe todavía. */
export type Mode = 'mock' | 'homologacion';

/** Variables de entorno tal como llegan del proceso. */
export type RawEnv = Record<string, string | undefined>;

export const MOCK_DATABASE_PATH = 'data/aldebaran-mock.db';
export const DEFAULT_DATABASE_PATH = 'data/aldebaran.db';

export class DatabasePathError extends Error {}

/** RF-184: el modo mock se activa solo cuando MOCK_MODE vale exactamente "true". */
export function resolveMode(raw: RawEnv): Mode {
  return raw.MOCK_MODE === 'true' ? 'mock' : 'homologacion';
}

/** Las rutas relativas se toman desde la raíz del repo (AGENTS.md). */
export function resolveFromRoot(path: string, repoRoot: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(repoRoot, path);
}

/**
 * RF-211 a RF-213: en mock se usa siempre la base del modo mock; fuera de mock, DATABASE_PATH o la
 * base por defecto, y nunca la del modo mock.
 */
export function resolveDatabasePath(mode: Mode, raw: RawEnv, repoRoot: string): string {
  const mockPath = resolveFromRoot(MOCK_DATABASE_PATH, repoRoot);
  if (mode === 'mock') return mockPath;

  const path = resolveFromRoot(raw.DATABASE_PATH || DEFAULT_DATABASE_PATH, repoRoot);
  if (path === mockPath) {
    throw new DatabasePathError(
      `DATABASE_PATH apunta a la base del modo mock (${MOCK_DATABASE_PATH}), que no se puede usar fuera del modo mock.`,
    );
  }
  return path;
}
