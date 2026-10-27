import { type Request, Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.ts';
import {
  createProduct,
  listProducts,
  type Product,
  ProductNotFoundError,
  setProductStatus,
  updateProduct,
} from '../../services/products.ts';
import { notFound } from '../errors.ts';
import { canEdit } from '../middleware/require-role.ts';
import { requiredText } from '../schemas.ts';
import type { ProductDto } from '../types.ts';
import { idParam, parse } from '../validate.ts';

/** RF-44 y RNF-13: precio en centavos enteros y mayor a cero ($0,01 es 1). */
const priceCents = z
  .number({ error: 'El precio es obligatorio y debe ser un número.' })
  .int('El precio no puede tener fracciones de centavo.')
  .min(1, 'El precio debe ser mayor a cero.');

const productSchema = z.object({
  name: requiredText('El nombre'),
  priceCents,
  currency: z.enum(['ARS', 'USD'], { error: 'La moneda debe ser pesos (ARS) o dólares (USD).' }), // RF-43
});

export const toProductDto = (product: Product): ProductDto => ({
  id: product.id,
  name: product.name,
  priceCents: product.priceCents,
  currency: product.currency,
  status: product.status,
});

/** Con un middleware antes del handler, Express no infiere el tipo de `:id` desde la ruta. */
type WithId = Request<{ id: string }>;

/** Ejecuta la acción traduciendo el producto inexistente a un 404. */
function run<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    throw error instanceof ProductNotFoundError ? notFound(error.message) : error;
  }
}

/** Productos: todos los perfiles los ven; Admin y Editor los modifican (RF-42 a RF-48, RF-159). */
export function productsRouter(ctx: AppContext): Router {
  const router = Router();
  const now = () => ctx.adapters.clock.now();

  router.get('/products', (_req, res) => {
    res.json(listProducts(ctx.db).map(toProductDto));
  });

  router.post('/products', canEdit(), (req, res) => {
    const input = parse(productSchema, req.body);
    res.status(201).json(toProductDto(createProduct(ctx.db, input, now())));
  });

  router.patch('/products/:id', canEdit(), (req: WithId, res) => {
    const id = idParam(req.params.id);
    const changes = parse(productSchema.partial(), req.body);
    res.json(toProductDto(run(() => updateProduct(ctx.db, id, changes, now()))));
  });

  router.post('/products/:id/deactivate', canEdit(), (req: WithId, res) => {
    const id = idParam(req.params.id);
    res.json(toProductDto(run(() => setProductStatus(ctx.db, id, 'inactivo', now()))));
  });

  router.post('/products/:id/reactivate', canEdit(), (req: WithId, res) => {
    const id = idParam(req.params.id);
    res.json(toProductDto(run(() => setProductStatus(ctx.db, id, 'activo', now()))));
  });

  return router;
}
