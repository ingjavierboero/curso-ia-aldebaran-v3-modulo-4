import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.ts';
import { authenticate, changeOwnPassword, toPublicUser, WrongPasswordError } from '../../services/auth.ts';
import { createSession, deleteSession } from '../../services/sessions.ts';
import { AppError, unauthorized } from '../errors.ts';
import { currentSessionToken, currentUser, SESSION_COOKIE, sessionCookieOptions } from '../middleware/session.ts';
import { newPassword } from '../schemas.ts';
import { parse } from '../validate.ts';

const loginSchema = z.object({ email: z.string().trim().min(1), password: z.string().min(1) });

// `strict`: un campo de más (por ejemplo, el id de otro usuario) se rechaza en lugar de ignorarse (AC-218).
const changePasswordSchema = z.strictObject({ currentPassword: z.string().min(1), newPassword });

/** Inicio y cierre de sesión, usuario actual y cambio de la propia contraseña (RF-02, RF-03, RF-21). */
export function authRouter(ctx: AppContext): Router {
  const router = Router();

  router.post('/auth/login', async (req, res) => {
    const result = loginSchema.safeParse(req.body);
    const user = result.success ? await authenticate(ctx.db, result.data.email, result.data.password) : null;
    // Mismo mensaje para email inexistente, contraseña incorrecta o usuario Inactivo.
    if (!user) throw unauthorized('Email o contraseña incorrectos.');

    const token = createSession(ctx.db, user.id, ctx.adapters.clock.now());
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions).json(toPublicUser(user));
  });

  router.post('/auth/logout', (_req, res) => {
    deleteSession(ctx.db, currentSessionToken(res));
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions).status(204).end();
  });

  router.get('/auth/me', (_req, res) => {
    res.json(toPublicUser(currentUser(res)));
  });

  router.post('/auth/password', async (req, res) => {
    const input = parse(changePasswordSchema, req.body);
    try {
      await changeOwnPassword(ctx.db, {
        userId: currentUser(res).id,
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        sessionToken: currentSessionToken(res),
        now: ctx.adapters.clock.now(),
      });
    } catch (error) {
      if (error instanceof WrongPasswordError) throw new AppError(400, 'contrasena_incorrecta', error.message);
      throw error;
    }
    res.status(204).end();
  });

  // Los endpoints de recuperación de contraseña se suman a este router en T053.
  return router;
}
