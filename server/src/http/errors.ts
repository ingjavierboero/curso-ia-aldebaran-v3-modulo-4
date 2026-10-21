/** Error de la API con su código HTTP y un mensaje apto para mostrarle al usuario (contracts/http-api.md). */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'validacion', message, details);

export const unauthorized = (message = 'Tenés que iniciar sesión.') => new AppError(401, 'sin_sesion', message);

export const forbidden = (message = 'Tu perfil no tiene permiso para esta acción.') =>
  new AppError(403, 'sin_permiso', message);

export const notFound = (message = 'No existe lo que buscás.') => new AppError(404, 'no_encontrado', message);

/** Conflicto de estado o de unicidad, por ejemplo una factura que cambió de estado (RF-218). */
export const conflict = (code: string, message: string, details?: unknown) => new AppError(409, code, message, details);

/** Regla de negocio que impide la acción, por ejemplo un recordatorio a un cliente en revisión (RF-157). */
export const unprocessable = (code: string, message: string, details?: unknown) =>
  new AppError(422, code, message, details);
