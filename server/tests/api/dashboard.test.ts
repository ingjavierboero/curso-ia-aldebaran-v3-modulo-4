import { describe, expect, it } from 'vitest';
import { exchangeRates, fallbackAlerts } from '../../src/db/schema.ts';
import { createTestApp, loggedInAgent, type TestApp } from '../helpers/test-app.ts';

const NOW = '2026-10-15T14:00:00.000Z';

/** Uso de la cotización de respaldo sin confirmar: el banner está visible (RF-69). */
function withFallbackBanner(t: TestApp) {
  const rate = t.db
    .insert(exchangeRates)
    .values({ rateCents: 152_000, source: 'dolarhoy.com', readAt: '2026-09-20T14:00:00.000Z' })
    .returning()
    .get();
  t.db.insert(fallbackAlerts).values({ exchangeRateId: rate.id, usedAt: NOW }).run();
}

describe('banner de cotización en el dashboard (RF-69, RF-70)', () => {
  it('AC-66: el dashboard muestra la cotización de respaldo usada y su fecha', async () => {
    const t = createTestApp({ now: NOW });
    withFallbackBanner(t);
    const { agent } = await loggedInAgent(t, { role: 'consulta' });

    const res = await agent.get('/api/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.banners.exchangeRate).toMatchObject({
      rateCents: 152_000,
      readAt: '2026-09-20T14:00:00.000Z',
      usedAt: NOW,
    });
    expect(res.body.banners.exchangeRate.message).toContain('20/09/2026');
  });

  it('sin uso de la cotización de respaldo no hay banner de cotización', async () => {
    const t = createTestApp({ now: NOW });
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    expect((await agent.get('/api/dashboard')).body.banners.exchangeRate).toBeNull();
  });

  it('AC-69: un Admin o un Editor confirma la cotización y el banner deja de mostrarse', async () => {
    for (const role of ['admin', 'editor'] as const) {
      const t = createTestApp({ now: NOW });
      withFallbackBanner(t);
      const { agent, user } = await loggedInAgent(t, { role });

      const res = await agent.post('/api/dashboard/exchange-rate/confirm');
      expect(res.status, role).toBe(200);
      expect(res.body.banners.exchangeRate, role).toBeNull();
      expect(t.db.select().from(fallbackAlerts).all()[0], role).toMatchObject({ confirmedByUserId: user.id });
    }
  });

  it('RF-13: un usuario Consulta no puede confirmar la cotización y el banner sigue visible', async () => {
    const t = createTestApp({ now: NOW });
    withFallbackBanner(t);
    const { agent } = await loggedInAgent(t, { role: 'consulta' });

    expect((await agent.post('/api/dashboard/exchange-rate/confirm')).status).toBe(403);
    expect((await agent.get('/api/dashboard')).body.banners.exchangeRate).not.toBeNull();
  });
});
