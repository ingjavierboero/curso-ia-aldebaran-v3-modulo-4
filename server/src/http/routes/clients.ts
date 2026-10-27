import { type Request, Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.ts';
import { isValidCuit, normalizeCuit } from '../../domain/cuit.ts';
import {
  type Client,
  ClientNotFoundError,
  createClient,
  DuplicateBillingEmailError,
  DuplicateCuitError,
  getClient,
  listClients,
  setClientStatus,
  updateClient,
} from '../../services/clients.ts';
import { conflict, notFound } from '../errors.ts';
import { canEdit } from '../middleware/require-role.ts';
import { currentUser } from '../middleware/session.ts';
import { email, requiredText } from '../schemas.ts';
import { CLIENT_IVA_CODES, CLIENT_IVA_CONDITIONS, type ClientDto, type ClientIvaCondition } from '../types.ts';
import { idParam, parse } from '../validate.ts';

/** RF-39: 11 dígitos con dígito verificador válido; se aceptan guiones, puntos y espacios. */
const cuit = z
  .string({ error: 'El CUIT es obligatorio.' })
  .regex(/^[\d\s.-]+$/, 'El CUIT solo puede tener números.')
  .transform(normalizeCuit)
  .refine(isValidCuit, 'El CUIT no es válido: revisá los 11 dígitos y el dígito verificador.');

/** RF-38: solo las condiciones que ARCA admite para el receptor de una Factura C. */
const ivaCondition = z.literal(CLIENT_IVA_CODES, {
  error: `La condición frente al IVA debe ser una de: ${Object.values(CLIENT_IVA_CONDITIONS).join(', ')}.`,
});

const clientSchema = z.object({
  businessName: requiredText('La razón social'),
  cuit,
  address: requiredText('El domicilio'),
  billingEmail: email,
  ivaCondition,
});

const toDto = (client: Client): ClientDto => ({
  id: client.id,
  businessName: client.businessName,
  cuit: client.cuit,
  address: client.address,
  billingEmail: client.billingEmail,
  ivaCondition: client.ivaCondition as ClientIvaCondition | null,
  status: client.status,
  createdAt: client.createdAt,
});

/** Con un middleware antes del handler, Express no infiere el tipo de `:id` desde la ruta. */
type WithId = Request<{ id: string }>;

/** Traduce los errores del servicio de clientes a respuestas de la API. */
function toHttpError(error: unknown): unknown {
  if (error instanceof DuplicateCuitError) return conflict('cuit_duplicado', error.message);
  if (error instanceof DuplicateBillingEmailError) return conflict('email_duplicado', error.message);
  if (error instanceof ClientNotFoundError) return notFound(error.message);
  return error;
}

/**
 * Clientes: todos los perfiles los ven; Admin y Editor los dan de alta, modifican, dan de baja y
 * reactivan (RF-34 a RF-41, RF-214). Los filtros, la búsqueda y el historial se suman en T132.
 */
export function clientsRouter(ctx: AppContext): Router {
  const router = Router();
  const now = () => ctx.adapters.clock.now();
  const actor = (res: Parameters<typeof currentUser>[0]) => ({ type: 'usuario' as const, userId: currentUser(res).id });

  /** Ejecuta la acción traduciendo los errores del servicio. */
  const run = <T>(action: () => T): T => {
    try {
      return action();
    } catch (error) {
      throw toHttpError(error);
    }
  };

  router.get('/clients', (_req, res) => {
    res.json(listClients(ctx.db).map(toDto));
  });

  router.get('/clients/:id', (req, res) => {
    const id = idParam(req.params.id);
    res.json(toDto(run(() => getClient(ctx.db, id))));
  });

  router.post('/clients', canEdit(), (req, res) => {
    const input = parse(clientSchema, req.body);
    res.status(201).json(toDto(run(() => createClient(ctx.db, input, actor(res), now()))));
  });

  router.patch('/clients/:id', canEdit(), (req: WithId, res) => {
    const id = idParam(req.params.id);
    const changes = parse(clientSchema.partial(), req.body);
    res.json(toDto(run(() => updateClient(ctx.db, id, changes, actor(res), now()))));
  });

  router.post('/clients/:id/deactivate', canEdit(), (req: WithId, res) => {
    const id = idParam(req.params.id);
    res.json(toDto(run(() => setClientStatus(ctx.db, id, 'inactivo', actor(res), now()))));
  });

  router.post('/clients/:id/reactivate', canEdit(), (req: WithId, res) => {
    const id = idParam(req.params.id);
    res.json(toDto(run(() => setClientStatus(ctx.db, id, 'activo', actor(res), now()))));
  });

  return router;
}
