import type { z } from 'zod';
import { badRequest } from './errors.ts';

/** Valida la entrada con zod; si no es válida, lanza un 400 con el detalle de cada campo inválido. */
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const fields = result.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }));
  throw badRequest(fields[0]?.message ?? 'Los datos enviados no son válidos.', { fields });
}

/** Convierte un parámetro de ruta (por ejemplo `:id`) en un id numérico positivo. */
export function idParam(value: string | undefined): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('El identificador no es válido.');
  return id;
}
