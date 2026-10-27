import * as cheerio from 'cheerio';
import { type ExchangeRateSource, TimeoutError } from '../types.ts';

const DOLARHOY_URL = 'https://dolarhoy.com/';

/** RNF-07: dolarhoy.com se da por caído si no responde en 10 s. */
export const DOLARHOY_TIMEOUT_MS = 10_000;

/** No se pudo leer la cotización: el sitio respondió con error, no hubo conexión o cambió el formato. */
export class ExchangeRateReadError extends Error {}

/** "1.555,50" o "$1.555" → centavos. Más de dos decimales, otro formato o cero son un error. */
function parseAmount(raw: string): number {
  const text = raw.replace(/\$/g, '').trim();
  const match = /^(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/.exec(text);
  if (!match) throw new ExchangeRateReadError(`La cotización de dolarhoy.com tiene un formato inesperado: "${raw}".`);
  const cents = Number((match[1] ?? '').replace(/\./g, '')) * 100 + Number((match[2] ?? '0').padEnd(2, '0'));
  if (cents <= 0) throw new ExchangeRateReadError(`La cotización de dolarhoy.com no es válida: "${raw}".`);
  return cents;
}

/**
 * Venta del dólar blue en la home de dolarhoy.com (research R-13): primero en la tabla de cotizaciones,
 * que trae centavos ("Dólar Libre": 1.555,00), y si no está, en el recuadro destacado ("Venta $1.555").
 */
export function parseBlueSell(html: string): number {
  const $ = cheerio.load(html);
  const blueLinks = $('a[href="/cotizaciondolarblue"]');
  const table = blueLinks.not('.titleText').find('.venta').first().text();
  const tile = blueLinks.filter('.titleText').closest('.tile').find('.venta .val').first().text();
  const raw = table.trim() || tile.trim();
  if (!raw) throw new ExchangeRateReadError('No se encontró la cotización del dólar blue en dolarhoy.com.');
  return parseAmount(raw);
}

/** RF-63: lee la venta del dólar blue de dolarhoy.com, con el timeout de 10 s de RNF-07. */
export function createDolarhoySource(fetchImpl: typeof fetch = fetch): ExchangeRateSource {
  return {
    async fetchBlueSell() {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(new TimeoutError('dolarhoy.com no respondió en 10 s.')),
        DOLARHOY_TIMEOUT_MS,
      );
      try {
        const response = await fetchImpl(DOLARHOY_URL, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (Aldebaran)', Accept: 'text/html' },
        });
        if (!response.ok) throw new ExchangeRateReadError(`dolarhoy.com respondió HTTP ${response.status}.`);
        return { rateCents: parseBlueSell(await response.text()), source: 'dolarhoy.com' as const };
      } catch (error) {
        if (error instanceof TimeoutError || error instanceof ExchangeRateReadError) throw error;
        throw new ExchangeRateReadError(
          `No se pudo conectar con dolarhoy.com: ${error instanceof Error ? error.message : 'error desconocido'}`,
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
