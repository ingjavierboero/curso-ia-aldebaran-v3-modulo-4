import { createHash, randomBytes } from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import type { Conn } from '../db/client.ts';
import { sessions, users } from '../db/schema.ts';

/** Vencimiento deslizante: la sesión vence tras 24 h sin actividad (RNF-10). */
export const SESSION_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export type User = typeof users.$inferSelect;

/** SHA-256 del token: en la base nunca se guarda el token en claro (research R-10). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Token aleatorio de 32 bytes, apto para cookies y URLs. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Abre una sesión para el usuario y devuelve el token que va en la cookie. */
export function createSession(conn: Conn, userId: number, now: Date): string {
  const token = newToken();
  const at = now.toISOString();
  conn.insert(sessions).values({ tokenHash: hashToken(token), userId, createdAt: at, lastActivityAt: at }).run();
  return token;
}

/**
 * Valida el token y devuelve el usuario de la sesión, leído de la base en cada solicitud para que los
 * cambios de perfil se apliquen enseguida (AC-17). Si la sesión venció por inactividad o el usuario
 * ya no está Activo, la sesión se borra y devuelve null. Si es válida, registra la actividad.
 */
export function resolveSession(conn: Conn, token: string, now: Date): User | null {
  const tokenHash = hashToken(token);
  const row = conn
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, tokenHash))
    .get();
  if (!row) return null;

  const idle = now.getTime() - new Date(row.session.lastActivityAt).getTime();
  if (idle >= SESSION_IDLE_TIMEOUT_MS || row.user.status !== 'activo') {
    conn.delete(sessions).where(eq(sessions.id, row.session.id)).run();
    return null;
  }

  conn.update(sessions).set({ lastActivityAt: now.toISOString() }).where(eq(sessions.id, row.session.id)).run();
  return row.user;
}

/** Cierra una sesión (AC-02). */
export function deleteSession(conn: Conn, token: string): void {
  conn.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))).run();
}

/**
 * Cierra las sesiones del usuario: todas (baja, RF-18) o todas salvo la indicada (cambio de
 * contraseña desde esa sesión, RF-21).
 */
export function deleteUserSessions(conn: Conn, userId: number, options: { exceptToken?: string } = {}): void {
  const condition = options.exceptToken
    ? and(eq(sessions.userId, userId), ne(sessions.tokenHash, hashToken(options.exceptToken)))
    : eq(sessions.userId, userId);
  conn.delete(sessions).where(condition).run();
}
