/**
 * Fakes programables de los puertos externos (contracts/adapters.md) para los tests: ninguno llama a
 * ARCA, Claude, Gmail ni dolarhoy.com (AGENTS.md). Cada fake registra sus llamadas y acepta una cola
 * de respuestas: un valor, un Error (para simular fallas, timeouts o códigos HTTP) o una función.
 */
import type {
  ArcaClient,
  AttachmentClassifier,
  AttachmentInput,
  AuthorizedVoucher,
  CaeRequest,
  CaeResult,
  CertificateStatus,
  ClassificationResult,
  Clock,
  ExchangeRateSource,
  IncomingEmail,
  Mailbox,
  MailSender,
  OutgoingEmail,
} from '../../src/adapters/types.ts';
import { TimeoutError } from '../../src/adapters/types.ts';

// ------------------------------------------------------------------ Reloj

export interface FakeClock extends Clock {
  set(instant: string | Date): void;
  advance(ms: number): void;
}

export function fixedClock(instant: string | Date): FakeClock {
  let current = new Date(instant);
  return {
    now: () => new Date(current),
    set: (value) => {
      current = new Date(value);
    },
    advance: (ms) => {
      current = new Date(current.getTime() + ms);
    },
  };
}

// ------------------------------------------------------------------ Respuestas programadas

/** Una respuesta programada: un valor, un error que se lanza o una función que calcula la respuesta. */
export type Step<T, A extends unknown[] = []> = T | Error | ((...args: A) => T | Promise<T>);

async function resolveStep<T, A extends unknown[]>(step: Step<T, A>, args: A): Promise<T> {
  if (step instanceof Error) throw step;
  if (typeof step === 'function') return (step as (...a: A) => T | Promise<T>)(...args);
  return step;
}

/** Error con código HTTP, para simular respuestas como 401, 429 o 500 (RNF-02). */
export class HttpStatusError extends Error {
  readonly status: number;

  constructor(status: number, message = `HTTP ${status}`) {
    super(message);
    this.status = status;
  }
}

/** Error de timeout de un servicio externo (RNF-07). */
export const timeout = (service = 'servicio externo') => new TimeoutError(`${service} no respondió a tiempo`);

// ------------------------------------------------------------------ ARCA

/**
 * ARCA fake: autoriza en orden y guarda los comprobantes autorizados, salvo que se programen
 * respuestas en `caeSteps` (por ejemplo, un timeout después de autorizar, para RF-76).
 */
export class FakeArca implements ArcaClient {
  readonly requests: CaeRequest[] = [];
  readonly vouchers = new Map<string, AuthorizedVoucher>();
  /** Respuestas de requestCae; `authorize` registra el comprobante como autorizado. */
  readonly caeSteps: Array<Step<CaeResult, [CaeRequest, () => CaeResult]>> = [];
  readonly lastNumberSteps: Array<Step<number, [number]>> = [];
  certificate: CertificateStatus = { readable: true, notAfter: new Date('2099-01-01T00:00:00Z') };
  private caeCounter = 0;

  async lastAuthorizedNumber(pointOfSale: number): Promise<number> {
    const step = this.lastNumberSteps.shift();
    if (step !== undefined) return resolveStep(step, [pointOfSale]);
    let last = 0;
    for (const key of this.vouchers.keys()) {
      const [pos, number] = key.split(':').map(Number) as [number, number];
      if (pos === pointOfSale) last = Math.max(last, number);
    }
    return last;
  }

  async requestCae(req: CaeRequest): Promise<CaeResult> {
    this.requests.push(req);
    const authorize = (): CaeResult => {
      this.caeCounter += 1;
      const result = { cae: String(70_000_000_000_000 + this.caeCounter), caeDueDate: '2099-12-31' };
      this.vouchers.set(`${req.pointOfSale}:${req.number}`, {
        ...result,
        totalCents: req.totalCents,
        receiverCuit: req.receiverCuit,
      });
      return result;
    };
    const step = this.caeSteps.shift();
    return step === undefined ? authorize() : resolveStep(step, [req, authorize]);
  }

  async findVoucher(pointOfSale: number, _voucherType: 11, number: number): Promise<AuthorizedVoucher | null> {
    return this.vouchers.get(`${pointOfSale}:${number}`) ?? null;
  }

  async certificateStatus(): Promise<CertificateStatus> {
    return this.certificate;
  }
}

// ------------------------------------------------------------------ Clasificador

/** Clasificador fake: responde por nombre de archivo o con `fallback` ("no" por defecto). */
export class FakeClassifier implements AttachmentClassifier {
  readonly calls: AttachmentInput[] = [];
  readonly byFilename = new Map<string, Step<ClassificationResult, [AttachmentInput]>>();
  fallback: Step<ClassificationResult, [AttachmentInput]> = { kind: 'no' };

  async classify(input: AttachmentInput): Promise<ClassificationResult> {
    this.calls.push(input);
    return resolveStep(this.byFilename.get(input.filename) ?? this.fallback, [input]);
  }
}

// ------------------------------------------------------------------ Email

/** Envío fake: acepta todo salvo que se programen fallas en `steps`; guarda solo lo enviado con éxito. */
export class FakeMailSender implements MailSender {
  readonly sent: OutgoingEmail[] = [];
  readonly attempts: OutgoingEmail[] = [];
  readonly steps: Array<Step<void, [OutgoingEmail]>> = [];
  private counter = 0;

  async send(msg: OutgoingEmail): Promise<{ messageId: string }> {
    this.attempts.push(msg);
    const step = this.steps.shift();
    if (step !== undefined) await resolveStep(step, [msg]);
    this.sent.push(msg);
    this.counter += 1;
    return { messageId: `<fake-${this.counter}@aldebaran.test>` };
  }
}

/** Casilla fake: devuelve los emails cargados en `emails` desde la fecha pedida, salvo que falle. */
export class FakeMailbox implements Mailbox {
  readonly address: string;
  readonly emails: IncomingEmail[] = [];
  readonly calls: Date[] = [];
  readonly steps: Array<Step<void, [Date]>> = [];

  constructor(address = 'sistema@aldebaran.test') {
    this.address = address;
  }

  async fetchSince(since: Date): Promise<IncomingEmail[]> {
    this.calls.push(since);
    const step = this.steps.shift();
    if (step !== undefined) await resolveStep(step, [since]);
    return this.emails.filter((email) => email.receivedAt.getTime() >= since.getTime());
  }
}

// ------------------------------------------------------------------ Cotización

/** Cotización fake: devuelve `rateCents` salvo que se programen respuestas en `steps`. */
export class FakeFx implements ExchangeRateSource {
  rateCents = 150_000;
  calls = 0;
  readonly steps: Array<Step<number>> = [];

  async fetchBlueSell(): Promise<{ rateCents: number; source: 'dolarhoy.com' }> {
    this.calls += 1;
    const step = this.steps.shift();
    const rateCents = step === undefined ? this.rateCents : await resolveStep(step, []);
    return { rateCents, source: 'dolarhoy.com' };
  }
}

// ------------------------------------------------------------------ Conjunto

/** Todos los adapters fake juntos, con el reloj en el instante indicado. */
export function createFakeAdapters(now: string | Date = '2026-10-15T14:00:00Z') {
  return {
    clock: fixedClock(now),
    arca: new FakeArca(),
    classifier: new FakeClassifier(),
    mailSender: new FakeMailSender(),
    mailbox: new FakeMailbox(),
    fx: new FakeFx(),
  };
}

export type FakeAdapters = ReturnType<typeof createFakeAdapters>;
