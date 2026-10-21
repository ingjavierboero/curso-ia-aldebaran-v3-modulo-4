/**
 * Puertos de los servicios externos (contracts/adapters.md). Cada uno tiene una implementación por
 * modo, elegida en adapters/index.ts (Constitución, Principio V); los servicios solo conocen estas
 * interfaces.
 */

export interface Clock {
  now(): Date;
}

// ------------------------------------------------------------------ ARCA (WSAA + WSFEv1)

/** Datos de la solicitud de CAE de una Factura C (RF-71 a RF-81). */
export interface CaeRequest {
  pointOfSale: number;
  voucherType: 11;
  number: number;
  issueDate: string;
  serviceFrom: string;
  serviceTo: string;
  dueDate: string;
  receiverCuit: string;
  receiverIvaCondition: number;
  totalCents: number;
}

export interface CaeResult {
  cae: string;
  caeDueDate: string;
}

/** Comprobante ya autorizado, para recuperar un CAE cuya respuesta se perdió (RF-76). */
export interface AuthorizedVoucher extends CaeResult {
  totalCents: number;
  receiverCuit: string;
}

export interface CertificateStatus {
  readable: boolean;
  notAfter: Date | null;
}

export interface ArcaClient {
  lastAuthorizedNumber(pointOfSale: number, voucherType: 11): Promise<number>;
  requestCae(req: CaeRequest): Promise<CaeResult>;
  findVoucher(pointOfSale: number, voucherType: 11, number: number): Promise<AuthorizedVoucher | null>;
  certificateStatus(): Promise<CertificateStatus>;
}

/** ARCA rechazó el comprobante por validación (no fue una falla de comunicación): no se reintenta (RF-171). */
export class ArcaRejectionError extends Error {}

// ------------------------------------------------------------------ Clasificación de adjuntos

export type ClassificationResult =
  | { kind: 'si'; cuit: string | null; amountRaw: string | null }
  | { kind: 'no' }
  | { kind: 'dudoso' }
  | { kind: 'error'; message: string };

export interface AttachmentInput {
  emailBody: string;
  filename: string;
  mimeType: string;
  content: Uint8Array;
}

export interface AttachmentClassifier {
  classify(input: AttachmentInput): Promise<ClassificationResult>;
}

// ------------------------------------------------------------------ Email

export interface EmailAttachment {
  filename: string;
  mimeType: string;
  content: Uint8Array;
}

export interface OutgoingEmail {
  fromName: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
}

export interface MailSender {
  send(msg: OutgoingEmail): Promise<{ messageId: string }>;
}

export interface IncomingEmail {
  messageId: string;
  from: string;
  subject: string;
  bodyText: string;
  receivedAt: Date;
  /** `inline` marca las imágenes embebidas en el cuerpo, que no cuentan como adjuntos (RF-116). */
  attachments: Array<EmailAttachment & { inline: boolean }>;
}

export interface Mailbox {
  /** Dirección de la casilla del sistema: GMAIL_USER o aldebaran-mock@gmail.com (RF-195). */
  readonly address: string;
  fetchSince(since: Date): Promise<IncomingEmail[]>;
}

// ------------------------------------------------------------------ Cotización

export interface ExchangeRateSource {
  fetchBlueSell(): Promise<{ rateCents: number; source: 'dolarhoy.com' }>;
}

// ------------------------------------------------------------------ Comunes

/** Un servicio externo no respondió dentro de su límite (RNF-02, RNF-07). */
export class TimeoutError extends Error {}

/** Todos los adapters que reciben los servicios, armados según el modo. */
export interface Adapters {
  clock: Clock;
  arca: ArcaClient;
  classifier: AttachmentClassifier;
  mailSender: MailSender;
  mailbox: Mailbox;
  fx: ExchangeRateSource;
}
