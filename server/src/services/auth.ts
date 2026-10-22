import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import type { Conn, Db } from '../db/client.ts';
import { users } from '../db/schema.ts';
import { deleteUserSessions, type User } from './sessions.ts';

/** Costo de bcrypt (RNF-09: costo ≥ 12). */
export const BCRYPT_COST = 12;

/** Largo mínimo de cualquier contraseña (RF-22). */
export const MIN_PASSWORD_LENGTH = 8;

// Hash de referencia para comparar cuando el email no existe: así un login con un email desconocido
// tarda lo mismo que uno con contraseña incorrecta y no revela qué emails están registrados.
const DUMMY_HASH = bcrypt.hashSync('contraseña-que-nadie-tiene', BCRYPT_COST);

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Datos públicos de un usuario: nunca incluye el hash de la contraseña (RF-07). */
export interface PublicUser {
  id: number;
  name: string;
  email: string;
  role: User['role'];
  status: User['status'];
}

export function toPublicUser(user: User): PublicUser {
  return { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function findUserByEmail(conn: Conn, email: string): User | undefined {
  return conn.select().from(users).where(eq(users.emailNormalized, normalizeEmail(email))).get();
}

/**
 * Valida email y contraseña (RF-02). Devuelve el usuario solo si existe, está Activo y la contraseña
 * es correcta; en cualquier otro caso devuelve null, sin distinguir el motivo.
 */
export async function authenticate(conn: Conn, email: string, password: string): Promise<User | null> {
  const user = findUserByEmail(conn, email);
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  return user && valid && user.status === 'activo' ? user : null;
}

export class WrongPasswordError extends Error {}

/**
 * RF-21: cambia la propia contraseña verificando la actual, y cierra las demás sesiones del usuario
 * (AC-249). La sesión desde la que se hace el cambio sigue abierta.
 */
export async function changeOwnPassword(
  db: Db,
  input: { userId: number; currentPassword: string; newPassword: string; sessionToken: string; now: Date },
): Promise<void> {
  const user = db.select().from(users).where(eq(users.id, input.userId)).get();
  if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new WrongPasswordError('La contraseña actual no es correcta.');
  }
  const passwordHash = await hashPassword(input.newPassword);
  db.transaction((tx) => {
    tx.update(users).set({ passwordHash, updatedAt: input.now.toISOString() }).where(eq(users.id, user.id)).run();
    deleteUserSessions(tx, user.id, { exceptToken: input.sessionToken });
  });
}
