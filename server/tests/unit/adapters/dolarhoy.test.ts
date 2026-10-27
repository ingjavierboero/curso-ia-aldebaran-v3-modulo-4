import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDolarhoySource, ExchangeRateReadError } from '../../../src/adapters/fx/dolarhoy.ts';
import { TimeoutError } from '../../../src/adapters/types.ts';

/** Recorte real de la home de dolarhoy.com: recuadro del blue (venta $1.555) y tabla (venta 1.555,00). */
const HOME = readFileSync(new URL('../../fixtures/dolarhoy.html', import.meta.url), 'utf8');

const html = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html' } });

/** fetch simulado que responde siempre lo mismo y registra cada llamada. */
const fetchReturning = (response: () => Response) => vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => response());

/** La home sin la tabla de cotizaciones: queda solo el recuadro destacado del blue. */
const ONLY_TILE = HOME.replace(/<div class="tile cotizaciones_more">[\s\S]*$/, '');

afterEach(() => vi.useRealTimers());

describe('lectura del dólar blue venta de dolarhoy.com (RF-63, research R-13)', () => {
  it('lee la venta del dólar blue de la home y la devuelve en centavos, con la fuente', async () => {
    const fetchMock = fetchReturning(() => html(HOME));
    const result = await createDolarhoySource(fetchMock).fetchBlueSell();

    expect(result).toEqual({ rateCents: 155_500, source: 'dolarhoy.com' });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://dolarhoy.com/');
  });

  it('toma los centavos de la tabla de cotizaciones', async () => {
    const withCents = HOME.replace('<div class="venta">1.555,00</div>', '<div class="venta">1.555,50</div>');
    const result = await createDolarhoySource(fetchReturning(() => html(withCents))).fetchBlueSell();
    expect(result.rateCents).toBe(155_550);
  });

  it('si la tabla no está, usa el recuadro destacado del blue', async () => {
    const result = await createDolarhoySource(fetchReturning(() => html(ONLY_TILE))).fetchBlueSell();
    expect(result.rateCents).toBe(155_500);
  });

  it('no confunde el blue con otras cotizaciones de la tabla (mayorista, MEP)', async () => {
    const withoutBlue = HOME.replace(/<div class="tile is-child"><a class="titleText"[\s\S]*?<\/div><\/div><\/div><\/div>/, '').replace(
      /<a href="\/cotizaciondolarblue">[\s\S]*?<\/a>/,
      '',
    );
    await expect(createDolarhoySource(fetchReturning(() => html(withoutBlue))).fetchBlueSell()).rejects.toBeInstanceOf(
      ExchangeRateReadError,
    );
  });

  it('falla si cambió el formato de la página y no encuentra la cotización', async () => {
    const source = createDolarhoySource(fetchReturning(() => html('<html><body>Mantenimiento</body></html>')));
    await expect(source.fetchBlueSell()).rejects.toBeInstanceOf(ExchangeRateReadError);
  });

  it('falla si la cotización no es un monto válido', async () => {
    for (const value of ['1,555.00', 'abc', '0,00']) {
      const broken = ONLY_TILE.replace(
        '<div class="label">Venta</div><div class="val">$1.555</div>',
        `<div class="label">Venta</div><div class="val">$${value}</div>`,
      );
      expect(broken, value).toContain(`$${value}`);
      await expect(createDolarhoySource(fetchReturning(() => html(broken))).fetchBlueSell(), value).rejects.toBeInstanceOf(
        ExchangeRateReadError,
      );
    }
  });

  it('falla si dolarhoy.com responde con un error HTTP', async () => {
    const source = createDolarhoySource(fetchReturning(() => html('Error', 503)));
    await expect(source.fetchBlueSell()).rejects.toBeInstanceOf(ExchangeRateReadError);
  });

  it('falla si no se puede conectar con dolarhoy.com', async () => {
    const source = createDolarhoySource(
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    await expect(source.fetchBlueSell()).rejects.toBeInstanceOf(ExchangeRateReadError);
  });

  it('AC-228, RNF-07: si dolarhoy.com no responde, da la llamada por fallida a los 10 s y la cancela', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    // fetch que nunca responde, salvo que se cancele la descarga.
    const hanging = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          signal = init?.signal ?? undefined;
          signal?.addEventListener('abort', () => reject(signal?.reason));
        }),
    );

    let failure: unknown;
    const pending = createDolarhoySource(hanging)
      .fetchBlueSell()
      .catch((error: unknown) => {
        failure = error;
      });

    await vi.advanceTimersByTimeAsync(9_000);
    expect(failure).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(failure).toBeInstanceOf(TimeoutError);
    expect(signal?.aborted).toBe(true);
  });
});
