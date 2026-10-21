/**
 * Esquema SQLite (data-model.md). Convenciones:
 * - Montos en centavos enteros (RNF-13).
 * - Timestamps ISO 8601 en UTC (`*At`); fechas civiles de Argentina `YYYY-MM-DD` (`*Date`, `service*`);
 *   períodos `YYYY-MM`.
 * - Emails también en minúsculas (`*Normalized`) para compararlos sin distinguir mayúsculas.
 * Cada cambio de esquema genera una migración nueva (`npm run db:generate -w server`); nunca se editan
 * las ya aplicadas.
 */
import { blob, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const id = () => integer('id').primaryKey({ autoIncrement: true });

const INVOICE_STATUSES = ['generando', 'pendiente_de_pago', 'pago_recibido', 'revision_manual', 'pagada'] as const;
const CLASSIFICATIONS = ['si', 'no', 'dudoso', 'error'] as const;
const RETRY_OPERATIONS = ['generacion_factura', 'envio_factura', 'envio_recordatorio'] as const;

// ------------------------------------------------------------------ Usuarios y acceso

export const users = sqliteTable('users', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  emailNormalized: text('email_normalized').notNull().unique(),
  role: text('role', { enum: ['admin', 'editor', 'consulta'] }).notNull(),
  status: text('status', { enum: ['activo', 'inactivo'] }).notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: id(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    lastActivityAt: text('last_activity_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const passwordResetTokens = sqliteTable(
  'password_reset_tokens',
  {
    id: id(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    sentAt: text('sent_at').notNull(),
    usedAt: text('used_at'),
    invalidatedAt: text('invalidated_at'),
  },
  (t) => [index('password_reset_tokens_user_idx').on(t.userId)],
);

// ------------------------------------------------------------------ Clientes y productos

export const clients = sqliteTable('clients', {
  id: id(),
  businessName: text('business_name').notNull(),
  cuit: text('cuit').notNull().unique(),
  address: text('address').notNull(),
  billingEmail: text('billing_email').notNull(),
  billingEmailNormalized: text('billing_email_normalized').notNull().unique(),
  // Null solo en clientes heredados sin el dato (RF-82).
  ivaCondition: integer('iva_condition'),
  status: text('status', { enum: ['activo', 'inactivo'] }).notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const products = sqliteTable('products', {
  id: id(),
  name: text('name').notNull(),
  priceCents: integer('price_cents').notNull(),
  currency: text('currency', { enum: ['ARS', 'USD'] }).notNull(),
  status: text('status', { enum: ['activo', 'inactivo'] }).notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const clientProducts = sqliteTable(
  'client_products',
  {
    id: id(),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    assignedAt: text('assigned_at').notNull(),
  },
  (t) => [uniqueIndex('client_products_client_product_unique').on(t.clientId, t.productId)],
);

// ------------------------------------------------------------------ Facturación

export const billingPeriods = sqliteTable('billing_periods', {
  id: id(),
  period: text('period').notNull().unique(),
  status: text('status', { enum: ['pendiente', 'en_curso', 'completado', 'cancelado'] }).notNull(),
  triggeredBy: text('triggered_by', {
    enum: ['agente_dia_15', 'agente_recuperacion', 'reactivacion', 'facturar_ahora'],
  }),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  cancelledByUserId: integer('cancelled_by_user_id').references(() => users.id),
  cancelledAt: text('cancelled_at'),
  reactivatedByUserId: integer('reactivated_by_user_id').references(() => users.id),
  reactivatedAt: text('reactivated_at'),
});

export const exchangeRates = sqliteTable('exchange_rates', {
  id: id(),
  rateCents: integer('rate_cents').notNull(),
  source: text('source').notNull(),
  readAt: text('read_at').notNull(),
});

/** Uso de una cotización de respaldo: muestra el banner hasta que un usuario la confirma (RF-69, RF-70). */
export const fallbackAlerts = sqliteTable('fallback_alerts', {
  id: id(),
  exchangeRateId: integer('exchange_rate_id')
    .notNull()
    .references(() => exchangeRates.id),
  usedAt: text('used_at').notNull(),
  confirmedByUserId: integer('confirmed_by_user_id').references(() => users.id),
  confirmedAt: text('confirmed_at'),
});

export const invoices = sqliteTable(
  'invoices',
  {
    id: id(),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id),
    period: text('period').notNull(),
    pointOfSale: integer('point_of_sale').notNull(),
    voucherType: integer('voucher_type').notNull().default(11),
    // Se asigna al pedir el CAE y vuelve a null si ARCA no lo autorizó (research R-05).
    number: integer('number'),
    issueDate: text('issue_date').notNull(),
    serviceFrom: text('service_from').notNull(),
    serviceTo: text('service_to').notNull(),
    dueDate: text('due_date').notNull(),
    totalCents: integer('total_cents').notNull(),
    cae: text('cae'),
    caeDueDate: text('cae_due_date'),
    ivaCondition: integer('iva_condition').notNull(),
    exchangeRateId: integer('exchange_rate_id').references(() => exchangeRates.id),
    clientSnapshot: text('client_snapshot', { mode: 'json' }).notNull(),
    issuerSnapshot: text('issuer_snapshot', { mode: 'json' }).notNull(),
    status: text('status', { enum: INVOICE_STATUSES }).notNull(),
    manualReviewReason: text('manual_review_reason'),
    arcaAttemptAt: text('arca_attempt_at'),
    arcaRequest: text('arca_request', { mode: 'json' }),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('invoices_client_period_unique').on(t.clientId, t.period),
    uniqueIndex('invoices_point_of_sale_number_unique').on(t.pointOfSale, t.number),
    index('invoices_status_idx').on(t.status),
  ],
);

export const invoiceItems = sqliteTable(
  'invoice_items',
  {
    id: id(),
    invoiceId: integer('invoice_id')
      .notNull()
      .references(() => invoices.id),
    productId: integer('product_id').references(() => products.id),
    description: text('description').notNull(),
    originalPriceCents: integer('original_price_cents').notNull(),
    originalCurrency: text('original_currency', { enum: ['ARS', 'USD'] }).notNull(),
    amountCents: integer('amount_cents').notNull(),
  },
  (t) => [index('invoice_items_invoice_idx').on(t.invoiceId)],
);

// ------------------------------------------------------------------ Emails

export const sentEmails = sqliteTable(
  'sent_emails',
  {
    id: id(),
    kind: text('kind', { enum: ['factura', 'recordatorio', 'recuperacion'] }).notNull(),
    trigger: text('trigger', { enum: ['automatico', 'manual', 'reintento_manual'] }).notNull(),
    clientId: integer('client_id').references(() => clients.id),
    invoiceId: integer('invoice_id').references(() => invoices.id),
    // Mes del recordatorio automático, para retomar una corrida interrumpida (RF-149).
    reminderMonth: text('reminder_month'),
    toAddress: text('to_address').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    sentAt: text('sent_at').notNull(),
    sentByUserId: integer('sent_by_user_id').references(() => users.id),
  },
  (t) => [index('sent_emails_client_idx').on(t.clientId)],
);

export const receivedEmails = sqliteTable(
  'received_emails',
  {
    id: id(),
    messageId: text('message_id').notNull().unique(),
    fromAddress: text('from_address').notNull(),
    fromNormalized: text('from_normalized').notNull(),
    subject: text('subject').notNull(),
    bodyText: text('body_text').notNull(),
    receivedAt: text('received_at').notNull(),
    // Null si el remitente no es ningún cliente: queda como aviso (RF-113).
    clientId: integer('client_id').references(() => clients.id),
    // Null si el email no tiene adjuntos (RF-115).
    classification: text('classification', { enum: CLASSIFICATIONS }),
    appliedRule: text('applied_rule'),
    processedAt: text('processed_at').notNull(),
  },
  (t) => [index('received_emails_client_idx').on(t.clientId)],
);

export const receivedAttachments = sqliteTable(
  'received_attachments',
  {
    id: id(),
    receivedEmailId: integer('received_email_id')
      .notNull()
      .references(() => receivedEmails.id),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    content: blob('content', { mode: 'buffer' }).notNull(),
    classification: text('classification', { enum: CLASSIFICATIONS }).notNull(),
    // Null si no se pudo extraer o no tiene 11 dígitos (RF-122).
    extractedCuit: text('extracted_cuit'),
    // Null si no se pudo extraer o es inválido; el texto original queda en extractedAmountRaw (RNF-13).
    extractedAmountCents: integer('extracted_amount_cents'),
    extractedAmountRaw: text('extracted_amount_raw'),
    errorMessage: text('error_message'),
  },
  (t) => [index('received_attachments_email_idx').on(t.receivedEmailId)],
);

export const notices = sqliteTable('notices', {
  id: id(),
  receivedEmailId: integer('received_email_id')
    .notNull()
    .unique()
    .references(() => receivedEmails.id),
  status: text('status', { enum: ['pendiente', 'revisado'] }).notNull(),
  reviewedByUserId: integer('reviewed_by_user_id').references(() => users.id),
  reviewedAt: text('reviewed_at'),
});

export const mailboxChecks = sqliteTable('mailbox_checks', {
  id: id(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  success: integer('success', { mode: 'boolean' }),
  emailsDetected: integer('emails_detected').notNull().default(0),
});

/** Casilla simulada: solo se usa en modo mock (RF-196 a RF-204). */
export const simulatedEmails = sqliteTable('simulated_emails', {
  id: id(),
  direction: text('direction', { enum: ['enviado', 'recibido'] }).notNull(),
  messageId: text('message_id').notNull().unique(),
  fromAddress: text('from_address').notNull(),
  fromName: text('from_name'),
  toAddress: text('to_address').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  createdAt: text('created_at').notNull(),
  loadedByUserId: integer('loaded_by_user_id').references(() => users.id),
});

export const simulatedAttachments = sqliteTable(
  'simulated_attachments',
  {
    id: id(),
    simulatedEmailId: integer('simulated_email_id')
      .notNull()
      .references(() => simulatedEmails.id),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    content: blob('content', { mode: 'buffer' }).notNull(),
  },
  (t) => [index('simulated_attachments_email_idx').on(t.simulatedEmailId)],
);

// ------------------------------------------------------------------ Estados de factura

export const invoiceStatusChanges = sqliteTable(
  'invoice_status_changes',
  {
    id: id(),
    invoiceId: integer('invoice_id')
      .notNull()
      .references(() => invoices.id),
    fromStatus: text('from_status', { enum: INVOICE_STATUSES }).notNull(),
    toStatus: text('to_status', { enum: INVOICE_STATUSES }).notNull(),
    // Motivo que tenía la factura antes del cambio, para el listado de resueltos (RF-216).
    previousReason: text('previous_reason'),
    reason: text('reason'),
    actorType: text('actor_type', { enum: ['agente', 'usuario'] }).notNull(),
    userId: integer('user_id').references(() => users.id),
    receivedEmailId: integer('received_email_id').references(() => receivedEmails.id),
    changedAt: text('changed_at').notNull(),
  },
  (t) => [index('invoice_status_changes_invoice_idx').on(t.invoiceId)],
);

/** Emails asociados a cada factura (RF-139, RF-141, RF-217). */
export const invoiceEmails = sqliteTable(
  'invoice_emails',
  {
    id: id(),
    invoiceId: integer('invoice_id')
      .notNull()
      .references(() => invoices.id),
    receivedEmailId: integer('received_email_id')
      .notNull()
      .references(() => receivedEmails.id),
  },
  (t) => [uniqueIndex('invoice_emails_invoice_email_unique').on(t.invoiceId, t.receivedEmailId)],
);

// ------------------------------------------------------------------ Procesos automáticos y errores

/** Reintentos persistidos de las operaciones automáticas (RF-171, research R-11). */
export const retryQueue = sqliteTable(
  'retry_queue',
  {
    id: id(),
    operation: text('operation', { enum: RETRY_OPERATIONS }).notNull(),
    clientId: integer('client_id').references(() => clients.id),
    period: text('period'),
    invoiceId: integer('invoice_id').references(() => invoices.id),
    payload: text('payload', { mode: 'json' }),
    attempt: integer('attempt').notNull(),
    nextAttemptAt: text('next_attempt_at').notNull(),
    lastError: text('last_error').notNull(),
  },
  (t) => [index('retry_queue_next_attempt_idx').on(t.nextAttemptAt)],
);

export const processErrors = sqliteTable(
  'process_errors',
  {
    id: id(),
    operation: text('operation', { enum: [...RETRY_OPERATIONS, 'revision_casilla'] }).notNull(),
    clientId: integer('client_id').references(() => clients.id),
    period: text('period'),
    invoiceId: integer('invoice_id').references(() => invoices.id),
    payload: text('payload', { mode: 'json' }),
    attempts: integer('attempts').notNull(),
    lastErrorMessage: text('last_error_message').notNull(),
    status: text('status', { enum: ['pendiente', 'resuelto'] }).notNull(),
    resolvedBy: text('resolved_by', { enum: ['reintento_manual', 'usuario', 'agente'] }),
    resolvedByUserId: integer('resolved_by_user_id').references(() => users.id),
    resolvedAt: text('resolved_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('process_errors_status_idx').on(t.status)],
);

export const reminderRuns = sqliteTable('reminder_runs', {
  id: id(),
  month: text('month').notNull().unique(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
});

// ------------------------------------------------------------------ Configuración e historial

/** Fila única (id = 1) con la configuración (RF-62, RF-73, RF-91, RF-100, RF-152, RF-172, RF-173). */
export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey(),
  mailboxIntervalMinutes: integer('mailbox_interval_minutes').notNull().default(15),
  billingTime: text('billing_time').notNull().default('11:00'),
  remindersTime: text('reminders_time').notNull().default('11:00'),
  retryCount: integer('retry_count').notNull().default(3),
  retryWaitMinutes: integer('retry_wait_minutes').notNull().default(5),
  pointOfSale: integer('point_of_sale'),
  issuerBusinessName: text('issuer_business_name'),
  issuerAddress: text('issuer_address'),
  issuerIvaCondition: text('issuer_iva_condition'),
  issuerGrossIncomeNumber: text('issuer_gross_income_number'),
  issuerActivityStartDate: text('issuer_activity_start_date'),
  issuerTradeName: text('issuer_trade_name'),
});

export const clientEvents = sqliteTable(
  'client_events',
  {
    id: id(),
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id),
    type: text('type').notNull(),
    payload: text('payload', { mode: 'json' }).notNull(),
    actorType: text('actor_type', { enum: ['agente', 'usuario'] }).notNull(),
    userId: integer('user_id').references(() => users.id),
    occurredAt: text('occurred_at').notNull(),
  },
  (t) => [index('client_events_client_idx').on(t.clientId)],
);

/** Token y firma de WSAA cacheados hasta su vencimiento; solo en homologación (research R-06). */
export const arcaTokens = sqliteTable('arca_tokens', {
  id: id(),
  service: text('service').notNull().unique(),
  token: text('token').notNull(),
  sign: text('sign').notNull(),
  expiresAt: text('expires_at').notNull(),
});
