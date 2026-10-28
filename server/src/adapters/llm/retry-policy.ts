import { TimeoutError } from '../types.ts';

/** RNF-02: cada llamada al LLM se da por fallida si no responde en 10 s. */
export const LLM_TIMEOUT_MS = 10_000;

/** RNF-02: esperas antes del primer, segundo y tercer reintento. */
export const RETRY_DELAYS_MS = [2_000, 4_000, 8_000] as const;

/** La respuesta no se puede interpretar o su clasificación no es "si", "no" ni "dudoso": se reintenta. */
export class InvalidLlmResponseError extends Error {}

/** La llamada falló sin reintento posible o después del cuarto intento: el procesamiento es erróneo. */
export class LlmFailedError extends Error {}

/** Código HTTP de un error del SDK (o de cualquier error que lo traiga), si tiene. */
const statusOf = (error: unknown): number | undefined => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
};

/**
 * RNF-02: se reintentan los timeouts, los errores de red, las respuestas HTTP 408, 429 y 5xx y las
 * respuestas que no se pueden interpretar. El resto de los 4xx (400, 401, 403, 404, 413...) no.
 */
function isRetryable(error: unknown): boolean {
  if (error instanceof TimeoutError || error instanceof InvalidLlmResponseError) return true;
  const status = statusOf(error);
  if (status === undefined) return true; // error de red o de conexión
  return status === 408 || status === 429 || status >= 500;
}

function describe(error: unknown): string {
  const status = statusOf(error);
  const message = error instanceof Error ? error.message : 'error desconocido';
  return status === undefined ? message : `HTTP ${status}: ${message}`;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Un intento con su límite de 10 s: si no responde a tiempo, cancela el pedido con la señal y lo da por
 * vencido, sin esperar a cómo reaccione el SDK a la cancelación.
 */
async function withTimeout<T>(attempt: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new TimeoutError('El LLM no respondió en 10 s.');
      controller.abort(error);
      reject(error);
    }, LLM_TIMEOUT_MS);
  });
  const call = attempt(controller.signal);
  call.catch(() => undefined); // si vence el plazo, su rechazo posterior ya no importa
  try {
    return await Promise.race([call, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Política de reintentos de RNF-02: hasta 4 intentos, esperando 2, 4 y 8 s antes de cada reintento.
 * Lanza LlmFailedError con el último error si no se puede reintentar o si falla el cuarto intento.
 */
export async function runWithRetries<T>(attempt: (signal: AbortSignal) => Promise<T>): Promise<T> {
  for (let index = 0; ; index += 1) {
    try {
      return await withTimeout(attempt);
    } catch (error) {
      const delay = RETRY_DELAYS_MS[index];
      if (!isRetryable(error) || delay === undefined) {
        throw new LlmFailedError(`El LLM falló después de ${index + 1} intento(s): ${describe(error)}`);
      }
      await sleep(delay);
    }
  }
}
