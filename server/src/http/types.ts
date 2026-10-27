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
  issuerIvaCondition: IssuerIvaCondition | null;
  issuerGrossIncomeNumber: string | null;
  issuerActivityStartDate: string | null;
  issuerTradeName: string | null;
  /** CUIT del emisor, de ARCA_CUIT: solo lectura. */
  issuerCuit: string;
}

/**
 * Condiciones frente al IVA que ARCA admite para el receptor de una Factura C, con su código (RF-38).
 */
export const CLIENT_IVA_CONDITIONS = {
  1: 'IVA Responsable Inscripto',
  4: 'IVA Sujeto Exento',
  5: 'Consumidor Final',
  6: 'Responsable Monotributo',
  7: 'Sujeto No Categorizado',
  8: 'Proveedor del Exterior',
  9: 'Cliente del Exterior',
  10: 'IVA Liberado – Ley N° 19.640',
  13: 'Monotributista Social',
  15: 'IVA No Alcanzado',
  16: 'Monotributo Trabajador Independiente Promovido',
} as const;

export type ClientIvaCondition = keyof typeof CLIENT_IVA_CONDITIONS;

export const CLIENT_IVA_CODES = Object.keys(CLIENT_IVA_CONDITIONS).map(Number) as ClientIvaCondition[];

/** Cliente (RF-34, RF-158, RF-214). `ivaCondition` es null solo en clientes heredados (RF-82). */
export interface ClientDto {
  id: number;
  businessName: string;
  cuit: string;
  address: string;
  billingEmail: string;
  ivaCondition: ClientIvaCondition | null;
  status: EntityStatus;
  /** Fecha y hora de alta (RF-214). */
  createdAt: string;
}

/** Alta y modificación de un cliente (`POST /api/clients`, `PATCH /api/clients/:id`). */
export interface ClientInput {
  businessName: string;
  cuit: string;
  address: string;
  billingEmail: string;
  ivaCondition: ClientIvaCondition;
}

/** Moneda del precio de un producto: pesos o dólares (RF-43). */
export type Currency = 'ARS' | 'USD';

/** Producto con el precio de su cuota mensual en centavos (RF-42, RF-159). */
export interface ProductDto {
  id: number;
  name: string;
  priceCents: number;
  currency: Currency;
  status: EntityStatus;
}

/** Alta y modificación de un producto (`POST /api/products`, `PATCH /api/products/:id`). */
export interface ProductInput {
  name: string;
  priceCents: number;
  currency: Currency;
}

/** Cuerpo de toda respuesta de error. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
