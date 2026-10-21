/**
 * Tipos de la API HTTP compartidos con web/ mediante el alias @api-types (contracts/http-api.md).
 * Montos en centavos; fechas `YYYY-MM-DD`; períodos `YYYY-MM`; timestamps ISO 8601.
 * Cada historia agrega acá los tipos de sus endpoints.
 */

export type Mode = 'mock' | 'homologacion';
export type Role = 'admin' | 'editor' | 'consulta';
export type EntityStatus = 'activo' | 'inactivo';

/** `GET /api/setup`: estado inicial de la app (RF-04, RF-209, RF-220). */
export interface SetupInfo {
  needsFirstAdmin: boolean;
  mode: Mode;
  emailRedirectTo: string | null;
}

/** Datos de un usuario que expone la API: nunca incluye el hash de la contraseña (RF-07). */
export interface UserDto {
  id: number;
  name: string;
  email: string;
  role: Role;
  status: EntityStatus;
}

/** Condiciones frente al IVA que admite la empresa emisora (RF-91). */
export const ISSUER_IVA_CONDITIONS = [
  'Responsable Monotributo',
  'Monotributista Social',
  'Monotributo Trabajador Independiente Promovido',
  'IVA Sujeto Exento',
] as const;

export type IssuerIvaCondition = (typeof ISSUER_IVA_CONDITIONS)[number];

/** `GET/PUT /api/settings` (RF-62, RF-73, RF-91, RF-100, RF-152, RF-172, RF-173). */
export interface SettingsDto {
  mailboxIntervalMinutes: number;
  billingTime: string;
  remindersTime: string;
  retryCount: number;
  retryWaitMinutes: number;
  pointOfSale: number | null;
  issuerBusinessName: string | null;
  issuerAddress: string | null;
  issuerIvaCondition: string | null;
  issuerGrossIncomeNumber: string | null;
  issuerActivityStartDate: string | null;
  issuerTradeName: string | null;
  /** CUIT del emisor, de ARCA_CUIT: solo lectura. */
  issuerCuit: string;
}

/** Cuerpo de toda respuesta de error. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
