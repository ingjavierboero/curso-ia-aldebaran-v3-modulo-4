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
  InactiveProductError,
  listClientProducts,
  listClients,
  setClientProducts,
  setClientStatus,
  updateClient,
} from '../../services/clients.ts';
import { listClientHistory } from '../../services/history.ts';
import { ProductNotFoundError } from '../../services/products.ts';
import { conflict, notFound, unprocessable } from '../errors.ts';
import { canEdit } from '../middleware/require-role.ts';
import { currentUser } from '../middleware/session.ts';
import { email, requiredText } from '../schemas.ts';
import {
  CLIENT_IVA_CODES,
  CLIENT_IVA_CONDITIONS,
  type ClientDto,
  type ClientIvaCondition,
  type ClientListItemDto,
} from '../types.ts';
import { idParam, parse } from '../validate.ts';
import { toProductDto } from './products.ts';

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

const productsSchema = z.object({
  productIds: z.array(z.number().int().positive(), { error: 'La lista de productos (productIds) es obligatoria.' }),
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

/** Filtros del listado de clientes (RF-169). */
const listFilters = z.object({
  status: z.enum(['activo', 'inactivo'], { error: 'El estado debe ser activo o inactivo.' }).optional(),
  q: z.string().max(200, 'La búsqueda es demasiado larga.').optional(),
});

/** Con un middleware antes del handler, Express no infiere el tipo de `:id` desde la ruta. */
type WithId = Request<{ id: string }>;

/** Traduce los errores del servicio de clientes a respuestas de la API. */
function toHttpError(error: unknown): unknown {
  if (error instanceof DuplicateCuitError) return conflict('cuit_duplicado', error.message);
  if (error instanceof DuplicateBillingEmailError) return conflict('email_duplicado', error.message);
  if (error instanceof ClientNotFoundError) return notFound(error.message);
  if (error instanceof ProductNotFoundError) return notFound(error.message);
  if (error instanceof InactiveProductError) return unprocessable('producto_inactivo', error.message);
  return error;
}

/**
 * Clientes: todos los perfiles los ven; Admin y Editor los dan de alta, modifican, dan de baja y
 * reactivan, y les asignan productos (RF-34 a RF-41, RF-49, RF-50, RF-214). El listado se filtra por
 * estado y se busca por razón social o CUIT (RF-169); cada cliente tiene su historial (RF-163).
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

  router.get('/clients', (req, res) => {
    const filters = parse(listFilters, req.query);
    const list: ClientListItemDto[] = listClients(ctx.db, filters).map((client) => ({
      ...toDto(client),
      debtCents: client.debtCents,
    }));
    res.json(list);
  });

  router.get('/clients/:id/history', (req, res) => {
    const id = idParam(req.params.id);
    run(() => getClient(ctx.db, id));
    res.json(listClientHistory(ctx.db, id));
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

  router.get('/clients/:id/products', (req, res) => {
    const id = idParam(req.params.id);
    res.json(run(() => listClientProducts(ctx.db, id)).map(toProductDto));
  });

  router.put('/clients/:id/products', canEdit(), (req: WithId, res) => {
    const id = idParam(req.params.id);
    const { productIds } = parse(productsSchema, req.body);
    res.json(run(() => setClientProducts(ctx.db, id, productIds, actor(res), now())).map(toProductDto));
  });

  return router;
}
