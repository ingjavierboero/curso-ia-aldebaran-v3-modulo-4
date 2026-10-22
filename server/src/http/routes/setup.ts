import { count } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.ts';
import type { Db } from '../../db/client.ts';
import { users } from '../../db/schema.ts';
import { hashPassword, normalizeEmail, toPublicUser } from '../../services/auth.ts';
import { forbidden } from '../errors.ts';
import { email, newPassword, requiredText } from '../schemas.ts';
import type { SetupInfo } from '../types.ts';
import { parse } from '../validate.ts';

const firstAdminSchema = z.object({ name: requiredText('El nombre'), email, password: newPassword });

const hasUsers = (db: Db) => (db.select({ total: count() }).from(users).get()?.total ?? 0) > 0;

/** Estado inicial de la app y registro del primer Admin (RF-04, RF-05). Ambos endpoints son públicos. */
export function setupRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/setup', (_req, res) => {
    const info: SetupInfo = {
      needsFirstAdmin: !hasUsers(ctx.db),
      mode: ctx.env.mode,
      emailRedirectTo: ctx.env.emailRedirectTo, // RF-220
    };
    res.json(info);
  });

  router.post('/setup/first-admin', async (req, res) => {
    // RF-05: una vez que existe un usuario, esta vía queda cerrada.
    if (hasUsers(ctx.db)) throw forbidden('El primer Admin ya fue registrado.');
    const input = parse(firstAdminSchema, req.body);
    const passwordHash = await hashPassword(input.password);
    const now = ctx.adapters.clock.now().toISOString();

    const created = ctx.db.transaction((tx) => {
      // Se vuelve a verificar dentro de la transacción por si dos registros llegan juntos.
      if ((tx.select({ total: count() }).from(users).get()?.total ?? 0) > 0) return null;
      return tx
        .insert(users)
        .values({
          name: input.name,
          email: input.email,
          emailNormalized: normalizeEmail(input.email),
          role: 'admin',
          status: 'activo',
          passwordHash,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
    });
    if (!created) throw forbidden('El primer Admin ya fue registrado.');
    res.status(201).json(toPublicUser(created));
  });

  return router;
}
