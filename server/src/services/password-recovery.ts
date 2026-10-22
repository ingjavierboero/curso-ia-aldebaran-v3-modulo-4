import { and, eq, isNull } from 'drizzle-orm';
import type { Adapters } from '../adapters/types.ts';
import type { Env } from '../config/env.ts';
import type { Conn, Db } from '../db/client.ts';
import { passwordResetTokens, users } from '../db/schema.ts';
import { passwordRecoveryEmail } from '../documents/email-templates.ts';
import { findUserByEmail, hashPassword } from './auth.ts';
import { hashToken, newToken, type User } from './sessions.ts';

/** El token de recuperación vence a los 10 minutos del envío (RF-26). */
export const RECOVERY_TOKEN_TTL_MS = 10 * 60 * 1000;

export class InvalidRecoveryTokenError extends Error {}

/**
 * RF-23 a RF-25 y RF-28: si el email es de un usuario Activo, invalida sus tokens anteriores, emite uno
 * nuevo y le envía el link armado con APP_URL. Para cualquier otro email no hace nada, y el llamador
 * responde lo mismo en los dos casos.
 */
export async function requestPasswordRecovery(
  db: Db,
  deps: { env: Env; adapters: Adapters },
  email: string,
): Promise<void> {
  const user = findUserByEmail(db, email);
  if (!user || user.status !== 'activo') return;

  const token = newToken();
  const sentAt = deps.adapters.clock.now().toISOString();
  const pending = and(
    eq(passwordResetTokens.userId, user.id),
    isNull(passwordResetTokens.usedAt),
    isNull(passwordResetTokens.invalidatedAt),
  );
  db.transaction((tx) => {
    tx.update(passwordResetTokens).set({ invalidatedAt: sentAt }).where(pending).run();
    tx.insert(passwordResetTokens).values({ tokenHash: hashToken(token), userId: user.id, sentAt }).run();
  });

  const url = `${deps.env.appUrl}/restablecer-contrasena/${token}`;
  await deps.adapters.mailSender.send(
    passwordRecoveryEmail({ to: user.email, name: user.name, url, validMinutes: RECOVERY_TOKEN_TTL_MS / 60_000 }),
  );
}

/**
 * RF-29 y RF-30: devuelve el token y su usuario si el token existe, no se usó, no se invalidó, no
 * venció y el usuario sigue Activo. En cualquier otro caso lanza InvalidRecoveryTokenError.
 */
function findValidToken(conn: Conn, token: string, now: Date): { tokenId: number; user: User } {
  const row = conn
    .select({ reset: passwordResetTokens, user: users })
    .from(passwordResetTokens)
    .innerJoin(users, eq(passwordResetTokens.userId, users.id))
    .where(eq(passwordResetTokens.tokenHash, hashToken(token)))
    .get();
  const valid =
    row !== undefined &&
    row.reset.usedAt === null &&
    row.reset.invalidatedAt === null &&
    now.getTime() - new Date(row.reset.sentAt).getTime() < RECOVERY_TOKEN_TTL_MS &&
    row.user.status === 'activo';
  if (!valid) throw new InvalidRecoveryTokenError('El link de recuperación no es válido o ya venció.');
  return { tokenId: row.reset.id, user: row.user };
}

/** Valida el token al ingresar a la URL (RF-29, RF-32). */
export function checkRecoveryToken(conn: Conn, token: string, now: Date): void {
  findValidToken(conn, token, now);
}

/** Cambia la contraseña con el token, volviendo a validarlo (RF-29), y lo marca como usado (RF-27). */
export async function resetPasswordWithToken(db: Db, token: string, newPassword: string, now: Date): Promise<void> {
  findValidToken(db, token, now);
  const passwordHash = await hashPassword(newPassword);
  db.transaction((tx) => {
    // Se revalida dentro de la transacción: otra solicitud pudo usar el token mientras se calculaba el hash.
    const { tokenId, user } = findValidToken(tx, token, now);
    const at = now.toISOString();
    tx.update(users).set({ passwordHash, updatedAt: at }).where(eq(users.id, user.id)).run();
    tx.update(passwordResetTokens).set({ usedAt: at }).where(eq(passwordResetTokens.id, tokenId)).run();
  });
}
