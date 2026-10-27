import { Router } from 'express';
import type { AppContext } from '../../context.ts';
import {
  BillingPeriodError,
  billingStatus,
  billNow,
  cancelBilling,
  reactivateBilling,
} from '../../services/billing-periods.ts';
import { conflict } from '../errors.ts';
import { onlyAdmin } from '../middleware/require-role.ts';
import { currentUser } from '../middleware/session.ts';

/** Traduce un rechazo del período (cancelado, en curso, realizado, iniciado) a un 409 (AC-56, AC-59, AC-60). */
function toHttpError(error: unknown): unknown {
  return error instanceof BillingPeriodError ? conflict(error.code, error.message) : error;
}

/**
 * Facturación del período del mes en curso: todos ven su estado; solo un Admin la cancela, la reactiva
 * o ejecuta "Facturar ahora" (RF-10, RF-54 a RF-61, AC-216).
 */
export function billingRouter(ctx: AppContext, log: (message: string) => void = console.error): Router {
  const router = Router();

  router.get('/billing/current', (_req, res) => {
    res.json(billingStatus(ctx));
  });

  router.post('/billing/current/bill-now', onlyAdmin(), (_req, res) => {
    let run: Promise<unknown>;
    try {
      run = billNow(ctx, currentUser(res).id);
    } catch (error) {
      throw toHttpError(error);
    }
    // La corrida puede tardar minutos (RNF-03): responde enseguida y sigue en segundo plano.
    run.catch((error: unknown) => {
      // Solo el tipo de error: el mensaje podría incluir datos sensibles (Constitución IV).
      log(`"Facturar ahora" falló: ${error instanceof Error ? error.name : typeof error}`);
    });
    res.status(202).json(billingStatus(ctx));
  });

  router.post('/billing/current/cancel', onlyAdmin(), async (_req, res) => {
    try {
      res.json(await cancelBilling(ctx, currentUser(res).id));
    } catch (error) {
      throw toHttpError(error);
    }
  });

  router.post('/billing/current/reactivate', onlyAdmin(), async (_req, res) => {
    try {
      res.json(await reactivateBilling(ctx, currentUser(res).id));
    } catch (error) {
      throw toHttpError(error);
    }
  });

  return router;
}
