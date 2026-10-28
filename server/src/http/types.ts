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

/** Estado de la facturación de un período (RF-54 a RF-61). */
export type BillingPeriodStatus = 'pendiente' | 'en_curso' | 'completado' | 'cancelado';

/** `GET /api/billing/current`: período del mes en curso y estado del botón "Facturar ahora". */
export interface BillingStatusDto {
  period: string;
  status: BillingPeriodStatus;
  billNow: { enabled: boolean; reason: string | null };
}

/** Banner de certificado de ARCA (RF-97, RF-98); `expiresAt` es la fecha de vencimiento en Argentina. */
export interface CertificateBannerDto {
  status: 'vencido' | 'ilegible' | 'por_vencer';
  expiresAt: string | null;
  message: string;
}

/** Banner de cotización: se facturó con la cotización de respaldo (RF-69). */
export interface ExchangeRateBannerDto {
  rateCents: number;
  readAt: string;
  usedAt: string;
  message: string;
}

/** `GET /api/dashboard`: banners del dashboard (los clientes con deuda se suman en US6). */
/** Cliente con deuda vigente en el dashboard (RF-153). */
export interface DebtorDto {
  clientId: number;
  businessName: string;
  clientStatus: EntityStatus;
  /** Suma de sus facturas adeudadas. */
  debtCents: number;
  owedInvoices: number;
  /** Tiene al menos una factura en Revisión manual. */
  inReview: boolean;
}

export interface DashboardDto {
  banners: {
    certificate: CertificateBannerDto | null;
    exchangeRate: ExchangeRateBannerDto | null;
  };
  /** Clientes con deuda vigente, de la mayor deuda a la menor (RF-153). */
  debtors: DebtorDto[];
}

export type InvoiceStatus = 'pendiente_de_pago' | 'pago_recibido' | 'revision_manual' | 'pagada';

/** Factura emitida en el listado (RF-160). */
export interface InvoiceDto {
  id: number;
  clientId: number;
  clientName: string;
  period: string;
  pointOfSale: number;
  number: number | null;
  voucherNumber: string | null;
  issueDate: string;
  dueDate: string;
  totalCents: number;
  status: InvoiceStatus;
  cae: string | null;
}

/** Adjunto de un email recibido, con el resultado del LLM (RF-124); `classification` es null en un aviso. */
export interface ReceivedAttachmentDto {
  id: number;
  filename: string;
  mimeType: string;
  classification: 'si' | 'no' | 'dudoso' | 'error' | null;
  cuit: string | null;
  amountCents: number | null;
  error: string | null;
}

/** Email recibido con sus adjuntos (RF-141, RF-142, RF-216, RF-217). */
export interface ReceivedEmailDto {
  id: number;
  from: string;
  subject: string;
  receivedAt: string;
  classification: 'si' | 'no' | 'dudoso' | 'error' | null;
  attachments: ReceivedAttachmentDto[];
}

/** Factura en la interfaz de revisión, con su motivo si está en Revisión manual. */
export interface ReviewInvoiceDto {
  id: number;
  clientId: number;
  clientName: string;
  period: string;
  voucherNumber: string | null;
  totalCents: number;
  dueDate: string;
  status: InvoiceStatus;
  reason: string | null;
}

/** `GET /api/review/payments`: factura en Pago recibido o Revisión manual con su evidencia (RF-141). */
export interface ReviewPaymentDto {
  invoice: ReviewInvoiceDto;
  emails: ReceivedEmailDto[];
}

/** `GET /api/review/notices`: aviso Pendiente (RF-142). */
export interface NoticeDto {
  id: number;
  email: ReceivedEmailDto;
}

/** `GET /api/review/resolved`: decisión de un usuario sobre un pago a revisar (RF-216). */
export interface ResolvedPaymentDto {
  invoice: ReviewInvoiceDto;
  decision: 'pagada' | 'pendiente_de_pago';
  decidedBy: { id: number; name: string };
  decidedAt: string;
  previousStatus: 'pago_recibido' | 'revision_manual';
  previousReason: string | null;
  emails: ReceivedEmailDto[];
}

/** Adjunto de un email de la casilla simulada, con su tipo verificado por la firma (RNF-16). */
export interface MockAttachmentDto {
  id: number;
  filename: string;
  mimeType: string;
}

/** `GET /api/mock-mailbox`: email enviado o recibido de la casilla simulada (RF-197, RF-198). */
export interface MockEmailDto {
  id: number;
  direction: 'enviado' | 'recibido';
  messageId: string;
  from: string;
  fromName: string | null;
  to: string;
  subject: string;
  body: string;
  /** Fecha de envío o, en un recibido, el momento de la carga (RF-196, RF-201). */
  createdAt: string;
  attachments: MockAttachmentDto[];
}

/** Cuerpo de toda respuesta de error. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
