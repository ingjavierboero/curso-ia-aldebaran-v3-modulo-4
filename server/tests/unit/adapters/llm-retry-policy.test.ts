import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InvalidLlmResponseError,
  LlmFailedError,
  runWithRetries,
} from '../../../src/adapters/llm/retry-policy.ts';
import { HttpStatusError } from '../../helpers/fakes.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Intento que falla con las respuestas indicadas, en orden, y después responde "ok". */
function attempts(...failures: Error[]) {
  const attempt = vi.fn(async (_signal: AbortSignal) => {
    const failure = failures[attempt.mock.calls.length - 1];
    if (failure) throw failure;
    return 'ok';
  });
  return attempt;
}

/** Resultado de la política, sin que un rechazo quede sin atender mientras avanza el reloj. */
function start(attempt: (signal: AbortSignal) => Promise<string>) {
  const outcome: { value?: string; error?: unknown; done: boolean } = { done: false };
  const promise = runWithRetries(attempt).then(
    (value) => Object.assign(outcome, { value, done: true }),
    (error: unknown) => Object.assign(outcome, { error, done: true }),
  );
  return { outcome, promise };
}

describe('reintentos de las llamadas al LLM (RNF-02)', () => {
  it('AC-116: falla dos veces y responde al tercer intento, con esperas de 2 s y 4 s', async () => {
    const attempt = attempts(new HttpStatusError(500), new HttpStatusError(503));
    const { outcome, promise } = start(attempt);

    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempt).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(attempt).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(outcome.value).toBe('ok');
  });

  it('si el cuarto intento también falla, el procesamiento es erróneo, después de esperar 2, 4 y 8 s', async () => {
    const attempt = attempts(...Array.from({ length: 4 }, () => new HttpStatusError(500)));
    const { outcome, promise } = start(attempt);

    await vi.advanceTimersByTimeAsync(2_000 + 4_000 + 7_999);
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(outcome.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(attempt).toHaveBeenCalledTimes(4);
    expect(outcome.error).toBeInstanceOf(LlmFailedError);
    expect((outcome.error as Error).message).toContain('500');
  });

  for (const status of [400, 401, 403, 404, 413]) {
    it(`AC-117, AC-118: HTTP ${status} no se reintenta y el procesamiento es erróneo de inmediato`, async () => {
      const attempt = attempts(new HttpStatusError(status), new HttpStatusError(status));
      const { outcome, promise } = start(attempt);
      await vi.advanceTimersByTimeAsync(0);
      await promise;
      expect(attempt).toHaveBeenCalledTimes(1);
      expect(outcome.error).toBeInstanceOf(LlmFailedError);
    });
  }

  for (const status of [429, 408]) {
    it(`AC-118: HTTP ${status} se reintenta a los 2 s y la segunda respuesta se usa`, async () => {
      const attempt = attempts(new HttpStatusError(status));
      const { outcome, promise } = start(attempt);
      await vi.advanceTimersByTimeAsync(2_000);
      await promise;
      expect(attempt).toHaveBeenCalledTimes(2);
      expect(outcome.value).toBe('ok');
    });
  }

  it('un error de red se reintenta', async () => {
    const attempt = attempts(new TypeError('fetch failed'));
    const { outcome, promise } = start(attempt);
    await vi.advanceTimersByTimeAsync(2_000);
    await promise;
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(outcome.value).toBe('ok');
  });

  it('una respuesta que no se puede interpretar se reintenta', async () => {
    const attempt = attempts(new InvalidLlmResponseError('la clasificación no es si, no ni dudoso'));
    const { outcome, promise } = start(attempt);
    await vi.advanceTimersByTimeAsync(2_000);
    await promise;
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(outcome.value).toBe('ok');
  });

  it('un intento que no responde en 10 s se corta, se cancela y se reintenta 2 s después', async () => {
    const signals: AbortSignal[] = [];
    const attempt = vi.fn(
      (signal: AbortSignal) =>
        new Promise<string>((resolve, reject) => {
          signals.push(signal);
          // El primer intento no responde; el segundo responde enseguida.
          if (signals.length > 1) resolve('ok');
          else signal.addEventListener('abort', () => reject(signal.reason));
        }),
    );
    const { outcome, promise } = start(attempt);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(signals[0]?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(outcome.value).toBe('ok');
  });

  it('AC-125: un LLM que responde HTTP 500 en los cuatro intentos termina en error', async () => {
    const attempt = attempts(...Array.from({ length: 4 }, () => new HttpStatusError(500)));
    const { outcome, promise } = start(attempt);
    await vi.advanceTimersByTimeAsync(14_000);
    await promise;
    expect(attempt).toHaveBeenCalledTimes(4);
    expect(outcome.error).toBeInstanceOf(LlmFailedError);
  });
});
