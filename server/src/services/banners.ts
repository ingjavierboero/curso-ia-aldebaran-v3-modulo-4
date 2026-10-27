import type { AppContext } from '../context.ts';
import type { Db } from '../db/client.ts';
import { civilDate } from '../domain/billing-dates.ts';
import { formatDate, formatInstantDate, formatMoney } from '../documents/format.ts';
import type { CertificateBannerDto, ExchangeRateBannerDto } from '../http/types.ts';
import { pendingFallback } from './exchange-rates.ts';

/** RF-98: el banner avisa desde que faltan 30 días o menos para el vencimiento. */
const WARNING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Banner de certificado de ARCA (RF-97, RF-98): vencido o ilegible, no se puede facturar; si vence
 * dentro de 30 días, avisa la fecha para renovarlo. Sin nada que avisar, o en modo mock, null.
 */
export async function certificateBanner(ctx: AppContext): Promise<CertificateBannerDto | null> {
  // RF-208: en modo mock no hay certificado ni banner de certificado.
  if (ctx.env.mode === 'mock') return null;
  const { readable, notAfter } = await ctx.adapters.arca.certificateStatus();
  if (!readable) {
    return {
      status: 'ilegible',
      expiresAt: null,
      message: 'No se puede leer el certificado de ARCA (ARCA_CERT_PATH): no se puede realizar la facturación.',
    };
  }
  if (!notAfter) return null;
  const expiresAt = civilDate(notAfter);
  const remaining = notAfter.getTime() - ctx.adapters.clock.now().getTime();
  if (remaining <= 0) {
    return {
      status: 'vencido',
      expiresAt,
      message: `El certificado de ARCA venció el ${formatDate(expiresAt)}: no se puede realizar la facturación.`,
    };
  }
  if (remaining <= WARNING_WINDOW_MS) {
    return {
      status: 'por_vencer',
      expiresAt,
      message: `El certificado de ARCA vence el ${formatDate(expiresAt)}: hay que renovarlo antes de esa fecha.`,
    };
  }
  return null;
}

/** Banner de cotización (RF-69): la cotización de respaldo usada y su fecha, hasta que se confirma. */
export function exchangeRateBanner(db: Db): ExchangeRateBannerDto | null {
  const fallback = pendingFallback(db);
  if (!fallback) return null;
  return {
    ...fallback,
    message:
      'dolarhoy.com no respondió: se facturó con la última cotización registrada, ' +
      `${formatMoney(fallback.rateCents)}, leída el ${formatInstantDate(fallback.readAt)}.`,
  };
}
