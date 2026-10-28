import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.ts';
import { authenticate, changeOwnPassword, toPublicUser, WrongPasswordError } from '../../services/auth.ts';
import {
  checkRecoveryToken,
  InvalidRecoveryTokenError,
  requestPasswordRecovery,
  resetPasswordWithToken,
} from '../../services/password-recovery.ts';
import { createSession, deleteSession } from '../../services/sessions.ts';
import { AppError, unauthorized } from '../errors.ts';
import { currentSessionToken, currentUser, SESSION_COOKIE, sessionCookieOptions } from '../middleware/session.ts';
import { newPassword } from '../schemas.ts';
import { parse } from '../validate.ts';

const loginSchema = z.object({ email: z.string().trim().min(1), password: z.string().min(1) });

// `strict`: un campo de más (por ejemplo, el id de otro usuario) se rechaza en lugar de ignorarse (AC-218).
const changePasswordSchema = z.strictObject({ currentPassword: z.string().min(1), newPassword });

const recoveryRequestSchema = z.object({ email: z.string().trim().min(1, 'El email es obligatorio.') });
const recoveryResetSchema = z.object({ newPassword });

const RECOVERY_REQUESTED =
  'Si el email corresponde a un usuario activo, te enviamos un link para restablecer la contraseña.';

/** RF-30: token inexistente, vencido o ya usado. */
function invalidToken(error: unknown): unknown {
  return error instanceof InvalidRecoveryTokenError ? new AppError(400, 'token_invalido', error.message) : error;
}

/**
 * Inicio y cierre de sesión, usuario actual, cambio de la propia contraseña y recuperación de la
 * contraseña (RF-02, RF-03, RF-21, RF-23 a RF-33).
 */
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

  router.post('/auth/recovery', async (req, res) => {
    // RF-199: en modo mock no hay recuperación de contraseña, así no queda ningún email en la casilla simulada.
    if (ctx.env.mode === 'mock') {
      throw new AppError(403, 'solo_fuera_de_mock', 'La recuperación de contraseña no está disponible en modo mock.');
    }
    const { email } = parse(recoveryRequestSchema, req.body);
    try {
      await requestPasswordRecovery(ctx.db, ctx, email);
    } catch (error) {
      // Si el envío falla, la respuesta es la misma: un error distinto revelaría que el email existe (RF-25).
      const reason = error instanceof Error ? error.name : typeof error;
      console.error(`No se pudo enviar el email de recuperación: ${reason}`);
    }
    res.json({ message: RECOVERY_REQUESTED });
  });

  router.get('/auth/recovery/:token', (req, res) => {
    try {
      checkRecoveryToken(ctx.db, req.params.token, ctx.adapters.clock.now());
    } catch (error) {
      throw invalidToken(error);
    }
    res.json({ valid: true });
  });

  router.post('/auth/recovery/:token', async (req, res) => {
    const input = parse(recoveryResetSchema, req.body);
    try {
      await resetPasswordWithToken(ctx.db, req.params.token, input.newPassword, ctx.adapters.clock.now());
    } catch (error) {
      throw invalidToken(error);
    }
    res.status(204).end();
  });

  return router;
}
