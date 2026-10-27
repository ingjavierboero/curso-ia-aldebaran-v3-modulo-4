import { desc, eq, isNull } from 'drizzle-orm';
import type { ExchangeRateSource } from '../adapters/types.ts';
import type { Db } from '../db/client.ts';
import { exchangeRates, fallbackAlerts } from '../db/schema.ts';

export type ExchangeRate = typeof exchangeRates.$inferSelect;

/** Cotización con la que se factura; `fallback` indica que es la última registrada (RF-67). */
export type RateForInvoice = ExchangeRate & { fallback: boolean };

/** dolarhoy.com no respondió y no hay ninguna cotización registrada: no se puede facturar en dólares (RF-68). */
export class NoExchangeRateError extends Error {}

/**
 * Cotización para generar una factura con ítems en dólares (RF-63 a RF-69, research R-13). Se lee de
 * dolarhoy.com en cada generación (también en reintentos) y cada lectura queda registrada con su valor,
 * fuente y fecha. Si el sitio no responde, usa la última registrada por fecha de lectura y deja el
 * banner de cotización pendiente de confirmar; si no hay ninguna, lanza NoExchangeRateError.
 */
export async function readRateForInvoice(db: Db, fx: ExchangeRateSource, now: Date): Promise<RateForInvoice> {
  try {
    const { rateCents, source } = await fx.fetchBlueSell();
    const rate = db.insert(exchangeRates).values({ rateCents, source, readAt: now.toISOString() }).returning().get();
    return { ...rate, fallback: false };
  } catch {
    const latest = db.select().from(exchangeRates).orderBy(desc(exchangeRates.readAt), desc(exchangeRates.id)).get();
    if (!latest) {
      throw new NoExchangeRateError('No se pudo leer la cotización del dólar y no hay ninguna registrada.');
    }
    recordFallbackUse(db, latest.id, now);
    return { ...latest, fallback: true };
  }
}

/**
 * RF-69: registra el uso de la cotización de respaldo. Mientras haya un aviso sin confirmar se actualiza
 * ese, así una corrida con muchos clientes en dólares no genera un aviso por factura.
 */
function recordFallbackUse(db: Db, exchangeRateId: number, now: Date): void {
  const usedAt = now.toISOString();
  const pending = db.select().from(fallbackAlerts).where(isNull(fallbackAlerts.confirmedAt)).get();
  if (pending) {
    db.update(fallbackAlerts).set({ exchangeRateId, usedAt }).where(eq(fallbackAlerts.id, pending.id)).run();
  } else {
    db.insert(fallbackAlerts).values({ exchangeRateId, usedAt }).run();
  }
}

/** Datos del banner de cotización (RF-69), o null si no hay un uso del respaldo sin confirmar. */
export function pendingFallback(db: Db): { rateCents: number; readAt: string; usedAt: string } | null {
  const row = db
    .select({ rateCents: exchangeRates.rateCents, readAt: exchangeRates.readAt, usedAt: fallbackAlerts.usedAt })
    .from(fallbackAlerts)
    .innerJoin(exchangeRates, eq(fallbackAlerts.exchangeRateId, exchangeRates.id))
    .where(isNull(fallbackAlerts.confirmedAt))
    .orderBy(desc(fallbackAlerts.usedAt))
    .get();
  return row ?? null;
}

/** RF-70: un Admin o Editor confirma la cotización de respaldo; el banner deja de mostrarse. */
export function confirmFallback(db: Db, userId: number, now: Date): void {
  db.update(fallbackAlerts)
    .set({ confirmedByUserId: userId, confirmedAt: now.toISOString() })
    .where(isNull(fallbackAlerts.confirmedAt))
    .run();
}
