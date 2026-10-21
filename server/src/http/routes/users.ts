import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.ts';
import { toPublicUser } from '../../services/auth.ts';
import {
  createUser,
  deactivateUser,
  DuplicateEmailError,
  LastAdminError,
  listUsers,
  reactivateUser,
  updateUser,
  UserNotFoundError,
} from '../../services/users.ts';
import { conflict, notFound, unprocessable } from '../errors.ts';
import { onlyAdmin } from '../middleware/require-role.ts';
import { email, newPassword, requiredText } from '../schemas.ts';
import { idParam, parse } from '../validate.ts';

const role = z.enum(['admin', 'editor', 'consulta'], { error: 'El perfil debe ser Admin, Editor o Consulta.' });

const createSchema = z.object({ name: requiredText('El nombre'), email, role, password: newPassword });
const updateSchema = z.object({ name: requiredText('El nombre').optional(), email: email.optional(), role: role.optional() });

/** Traduce los errores del servicio de usuarios a respuestas de la API. */
function toHttpError(error: unknown): unknown {
  if (error instanceof DuplicateEmailError) return conflict('email_duplicado', error.message);
  if (error instanceof LastAdminError) return unprocessable('ultimo_admin', error.message);
  if (error instanceof UserNotFoundError) return notFound(error.message);
  return error;
}

/** Gestión de usuarios: solo Admin (RF-14 a RF-20, RF-161; Editor y Consulta, AC-213 y AC-214). */
export function usersRouter(ctx: AppContext): Router {
  const router = Router();
  const now = () => ctx.adapters.clock.now();

  router.use('/users', onlyAdmin());

  router.get('/users', (_req, res) => {
    res.json(listUsers(ctx.db).map(toPublicUser));
  });

  router.post('/users', async (req, res) => {
    const input = parse(createSchema, req.body);
    try {
      res.status(201).json(toPublicUser(await createUser(ctx.db, input, now())));
    } catch (error) {
      throw toHttpError(error);
    }
  });

  router.patch('/users/:id', (req, res) => {
    const id = idParam(req.params.id);
    const changes = parse(updateSchema, req.body);
    try {
      res.json(toPublicUser(updateUser(ctx.db, id, changes, now())));
    } catch (error) {
      throw toHttpError(error);
    }
  });

  router.post('/users/:id/deactivate', (req, res) => {
    const id = idParam(req.params.id);
    try {
      res.json(toPublicUser(deactivateUser(ctx.db, id, now())));
    } catch (error) {
      throw toHttpError(error);
    }
  });

  router.post('/users/:id/reactivate', (req, res) => {
    const id = idParam(req.params.id);
    try {
      res.json(toPublicUser(reactivateUser(ctx.db, id, now())));
    } catch (error) {
      throw toHttpError(error);
    }
  });

  return router;
}
