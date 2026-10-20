# Contract: puertos de servicios externos

Interfaces TypeScript que consumen los servicios. Cada una tiene una implementación por modo, elegida
en `server/src/adapters/index.ts` (Constitución V, research R-01). Los tests de integración usan
fakes programables que cumplen la misma interfaz y simulan fallas, timeouts y códigos HTTP.

```ts
type Mode = 'mock' | 'homologacion';

interface Clock { now(): Date }

// ARCA (WSAA + WSFEv1). Real: solo endpoints de homologación. Mock: RF-185, RF-186.
interface ArcaClient {
  lastAuthorizedNumber(pointOfSale: number, voucherType: 11): Promise<number>;
  requestCae(req: CaeRequest): Promise<{ cae: string; caeDueDate: string }>;     // FECAESolicitar
  findVoucher(pointOfSale: number, voucherType: 11, number: number)
    : Promise<{ cae: string; caeDueDate: string; totalCents: number; receiverCuit: string } | null>;
  certificateStatus(): Promise<{ readable: boolean; notAfter: Date | null }>;     // RF-97, RF-98
}
interface CaeRequest {
  pointOfSale: number; voucherType: 11; number: number;
  issueDate: string; serviceFrom: string; serviceTo: string; dueDate: string;
  receiverCuit: string; receiverIvaCondition: number; totalCents: number;
}

// Clasificación de un adjunto. Real: Claude (R-07) con la política de reintentos de RNF-02.
// Mock: por nombre de archivo (RF-188 a RF-193); nunca llama a la API.
interface AttachmentClassifier {
  classify(input: { emailBody: string; filename: string; mimeType: string; content: Uint8Array })
    : Promise<ClassificationResult>;
}
type ClassificationResult =
  | { kind: 'si'; cuit: string | null; amountRaw: string | null }
  | { kind: 'no' } | { kind: 'dudoso' } | { kind: 'error'; message: string };

// Envío de email. Real: SMTP de Gmail (EMAIL_REDIRECT_TO opcional). Mock: casilla simulada (RF-196).
interface MailSender {
  send(msg: OutgoingEmail): Promise<{ messageId: string }>;
}
interface OutgoingEmail {
  fromName: string; to: string; subject: string; text: string; html?: string;
  attachments?: { filename: string; mimeType: string; content: Uint8Array }[];
}

// Lectura de la casilla. Real: IMAP (R-08). Mock: emails recibidos de la casilla simulada (RF-203).
interface Mailbox {
  readonly address: string;                       // GMAIL_USER o aldebaran-mock@gmail.com (RF-195)
  fetchSince(since: Date): Promise<IncomingEmail[]>;
}
interface IncomingEmail {
  messageId: string; from: string; subject: string; bodyText: string; receivedAt: Date;
  attachments: { filename: string; mimeType: string; content: Uint8Array; inline: boolean }[];
}

// Cotización del dólar blue venta. Igual en ambos modos (PRD, Fuera de Alcance).
interface ExchangeRateSource {
  fetchBlueSell(): Promise<{ rateCents: number; source: 'dolarhoy.com' }>;
}
```

## Reglas comunes

- Cada implementación real aplica su timeout de RNF-07 (ARCA y email 30 s, dolarhoy.com 10 s) y el
  LLM 10 s por intento (RNF-02); al vencer lanza un error tipado `TimeoutError`.
- Las implementaciones nunca registran secretos en logs ni mensajes de error (Constitución IV).
- `adapters/arca/endpoints.ts` contiene solo URLs de homologación; un test lo verifica.

## Reglas del clasificador mock (RF-189 a RF-193, sin distinguir mayúsculas)

| Nombre de archivo | Resultado |
|-------------------|-----------|
| `pago_<CUIT>_<monto>.<ext>` | `si` con ese CUIT y monto (punto decimal) |
| `pago_x_<monto>.<ext>` o `pago_<CUIT>_x.<ext>` | `si` con el dato faltante en `null` |
| empieza con `dudoso` | `dudoso` |
| empieza con `error` | `error` |
| cualquier otro | `no` |
