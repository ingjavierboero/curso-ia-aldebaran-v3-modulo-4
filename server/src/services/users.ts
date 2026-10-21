import { and, asc, count, eq, ne } from 'drizzle-orm';
import type { Conn, Db } from '../db/client.ts';
import { users } from '../db/schema.ts';
import type { Role } from '../http/types.ts';
import { hashPassword, normalizeEmail } from './auth.ts';
import { deleteUserSessions, type User } from './sessions.ts';

/** El email ya lo tiene otro usuario, sin distinguir mayúsculas (RF-15). */
export class DuplicateEmailError extends Error {}
/** La acción dejaría al sistema sin ningún Admin Activo (RF-20). */
export class LastAdminError extends Error {}
export class UserNotFoundError extends Error {}

export function listUsers(conn: Conn): User[] {
  return conn.select().from(users).orderBy(asc(users.name), asc(users.id)).all();
}

function getUser(conn: Conn, id: number): User {
  const user = conn.select().from(users).where(eq(users.id, id)).get();
  if (!user) throw new UserNotFoundError('El usuario no existe.');
  return user;
}

function assertEmailFree(conn: Conn, email: string, exceptUserId?: number) {
  const normalized = normalizeEmail(email);
  const condition = exceptUserId
    ? and(eq(users.emailNormalized, normalized), ne(users.id, exceptUserId))
    : eq(users.emailNormalized, normalized);
  if (conn.select({ id: users.id }).from(users).where(condition).get()) {
    throw new DuplicateEmailError('Ya existe un usuario con ese email.');
  }
}

/** RF-20: rechaza la acción si el usuario es el único Admin Activo. */
function assertNotLastActiveAdmin(conn: Conn, user: User) {
  if (user.role !== 'admin' || user.status !== 'activo') return;
  const others = conn
    .select({ total: count() })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.status, 'activo'), ne(users.id, user.id)))
    .get();
  if ((others?.total ?? 0) === 0) {
    throw new LastAdminError('No se puede dejar al sistema sin ningún Admin Activo.');
  }
}

/** RF-14: alta de un usuario, que queda Activo. */
export async function createUser(
  db: Db,
  input: { name: string; email: string; role: Role; password: string },
  now: Date,
): Promise<User> {
  assertEmailFree(db, input.email);
  const passwordHash = await hashPassword(input.password);
  const at = now.toISOString();
  return db.transaction((tx) => {
    // Se vuelve a verificar dentro de la transacción: el hash tarda y otra alta pudo entrar en el medio.
    assertEmailFree(tx, input.email);
    return tx
      .insert(users)
      .values({
        name: input.name,
        email: input.email,
        emailNormalized: normalizeEmail(input.email),
        role: input.role,
        status: 'activo',
        passwordHash,
        createdAt: at,
        updatedAt: at,
      })
      .returning()
      .get();
  });
}

/** RF-16, RF-17: modifica nombre, email y perfil; el cambio de perfil rige desde la siguiente solicitud. */
export function updateUser(
  db: Db,
  id: number,
  changes: { name?: string; email?: string; role?: Role },
  now: Date,
): User {
  return db.transaction((tx) => {
    const user = getUser(tx, id);
    if (changes.email !== undefined) assertEmailFree(tx, changes.email, id);
    if (changes.role !== undefined && changes.role !== 'admin') assertNotLastActiveAdmin(tx, user);

    return tx
      .update(users)
      .set({
        ...(changes.name !== undefined && { name: changes.name }),
        ...(changes.email !== undefined && { email: changes.email, emailNormalized: normalizeEmail(changes.email) }),
        ...(changes.role !== undefined && { role: changes.role }),
        updatedAt: now.toISOString(),
      })
      .where(eq(users.id, id))
      .returning()
      .get() as User;
  });
}

/** RF-18: el usuario pasa a Inactivo y se cierran todas sus sesiones (AC-249). */
export function deactivateUser(db: Db, id: number, now: Date): User {
  return db.transaction((tx) => {
    const user = getUser(tx, id);
    assertNotLastActiveAdmin(tx, user);
    const updated = tx
      .update(users)
      .set({ status: 'inactivo', updatedAt: now.toISOString() })
      .where(eq(users.id, id))
      .returning()
      .get() as User;
    deleteUserSessions(tx, id);
    return updated;
  });
}

/** RF-19: el usuario vuelve a Activo. */
export function reactivateUser(db: Db, id: number, now: Date): User {
  return db.transaction((tx) => {
    getUser(tx, id);
    return tx
      .update(users)
      .set({ status: 'activo', updatedAt: now.toISOString() })
      .where(eq(users.id, id))
      .returning()
      .get() as User;
  });
}
