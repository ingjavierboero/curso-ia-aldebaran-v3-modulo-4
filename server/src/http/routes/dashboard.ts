import { Router } from 'express';
import type { AppContext } from '../../context.ts';
import { certificateBanner, exchangeRateBanner } from '../../services/banners.ts';
import { confirmFallback } from '../../services/exchange-rates.ts';
import { canEdit } from '../middleware/require-role.ts';
import { currentUser } from '../middleware/session.ts';
import type { DashboardDto } from '../types.ts';

/** Dashboard: banners de certificado y cotización (RF-69, RF-97, RF-98); la deuda se suma en US6. */
export function dashboardRouter(ctx: AppContext): Router {
  const router = Router();

  const dashboard = async (): Promise<DashboardDto> => ({
    banners: { certificate: await certificateBanner(ctx), exchangeRate: exchangeRateBanner(ctx.db) },
  });

  router.get('/dashboard', async (_req, res) => {
    res.json(await dashboard());
  });

  // RF-70: un Admin o un Editor confirma la cotización de respaldo.
  router.post('/dashboard/exchange-rate/confirm', canEdit(), async (_req, res) => {
    confirmFallback(ctx.db, currentUser(res).id, ctx.adapters.clock.now());
    res.json(await dashboard());
  });

  return router;
}
