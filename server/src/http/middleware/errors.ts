import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiErrorBody } from '../types.ts';
import { AppError, notFound } from '../errors.ts';

/** Rutas de la API que no existen: 404 con el formato de error de la API. */
export const apiNotFound: RequestHandler = (_req, _res, next) => next(notFound('La ruta no existe.'));

/**
 * Convierte cualquier error en `{ error: { code, message, details? } }`. Los errores inesperados se
 * responden con un mensaje genérico y se registran sin su mensaje: nunca se devuelven ni se loguean
 * detalles internos que puedan incluir secretos (Constitución, Principio IV).
 */
export function errorHandler(log: (message: string) => void = console.error): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    let status = 500;
    let body: ApiErrorBody = { error: { code: 'error_interno', message: 'Ocurrió un error inesperado.' } };

    if (err instanceof AppError) {
      status = err.status;
      body = { error: { code: err.code, message: err.message } };
      if (err.details !== undefined) body.error.details = err.details;
    } else if (isBodyParserError(err)) {
      status = err.type === 'entity.too.large' ? 413 : 400;
      body = {
        error: {
          code: 'validacion',
          message: status === 413 ? 'El cuerpo de la solicitud es demasiado grande.' : 'El cuerpo de la solicitud no es JSON válido.',
        },
      };
    } else {
      log(`Error no controlado en la API: ${err instanceof Error ? err.name : typeof err}`);
    }

    res.status(status).json(body);
  };
}

function isBodyParserError(err: unknown): err is { type: string } {
  return typeof err === 'object' && err !== null && 'type' in err && typeof err.type === 'string' && err.type.startsWith('entity.');
}
