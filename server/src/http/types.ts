/**
 * Tipos de la API HTTP compartidos con web/ mediante el alias @api-types (contracts/http-api.md).
 * Montos en centavos; fechas `YYYY-MM-DD`; períodos `YYYY-MM`; timestamps ISO 8601.
 * Cada historia agrega acá los tipos de sus endpoints.
 */

export type Mode = 'mock' | 'homologacion';
export type Role = 'admin' | 'editor' | 'consulta';
export type EntityStatus = 'activo' | 'inactivo';

/** Cuerpo de toda respuesta de error. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
