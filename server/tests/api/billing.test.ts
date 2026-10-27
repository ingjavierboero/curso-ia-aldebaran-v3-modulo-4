import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { billingPeriods, invoices } from '../../src/db/schema.ts';
import { createTestApp, loggedInAgent, type TestApp } from '../helpers/test-app.ts';
import { assignProduct, configureIssuer, insertClient, insertProduct } from '../helpers/test-db.ts';

/** 10/10/2026 a las 10:00 de Argentina: período de octubre, antes del día 15. */
const OCT_10 = '2026-10-10T13:00:00.000Z';

const CANCELLED = /cancelada/i;
const IN_PROGRESS = 'facturación en curso';
const DONE = 'facturación del mes ya realizada';

function billingApp() {
  const t = createTestApp({ now: OCT_10 });
  configureIssuer(t.db);
  const client = insertClient(t.db, { ivaCondition: 6 });
  assignProduct(t.db, client.id, insertProduct(t.db).id);
  return t;
}

const setPeriod = (t: TestApp, status: 'pendiente' | 'en_curso' | 'completado' | 'cancelado') =>
  t.db.insert(billingPeriods).values({ period: '2026-10', status, startedAt: status === 'pendiente' ? null : OCT_10 }).run();

const periodRow = (t: TestApp) => t.db.select().from(billingPeriods).where(eq(billingPeriods.period, '2026-10')).get();
const invoiceCount = (t: TestApp) => t.db.select().from(invoices).all().length;

describe('estado del período y del botón "Facturar ahora" (RF-60, RF-61)', () => {
  it('con el período sin empezar, el botón está habilitado; lo ven Admin, Editor y Consulta', async () => {
    const t = billingApp();
    for (const role of ['admin', 'editor', 'consulta'] as const) {
      const { agent } = await loggedInAgent(t, { role });
      const res = await agent.get('/api/billing/current');
      expect(res.status, role).toBe(200);
      expect(res.body, role).toEqual({ period: '2026-10', status: 'pendiente', billNow: { enabled: true, reason: null } });
    }
  });

  it('AC-59: con el período cancelado, el botón está deshabilitado porque la facturación del mes está cancelada', async () => {
    const t = billingApp();
    setPeriod(t, 'cancelado');
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const res = await agent.get('/api/billing/current');
    expect(res.body).toMatchObject({ status: 'cancelado', billNow: { enabled: false, reason: expect.stringMatching(CANCELLED) } });
  });

  it('AC-60: con la facturación en ejecución, el botón indica "facturación en curso"; al terminar, "facturación del mes ya realizada"', async () => {
    const t = billingApp();
    setPeriod(t, 'en_curso');
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    expect((await agent.get('/api/billing/current')).body.billNow).toEqual({ enabled: false, reason: IN_PROGRESS });

    t.db.update(billingPeriods).set({ status: 'completado' }).where(eq(billingPeriods.period, '2026-10')).run();
    expect((await agent.get('/api/billing/current')).body.billNow).toEqual({ enabled: false, reason: DONE });
  });
});

describe('"Facturar ahora" (RF-58 a RF-61)', () => {
  it('RF-58: un Admin ejecuta "Facturar ahora": responde enseguida y la corrida factura el período en curso', async () => {
    const t = billingApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });

    const res = await agent.post('/api/billing/current/bill-now');
    expect(res.status).toBe(202);
    await vi.waitFor(() => expect(periodRow(t)?.status).toBe('completado'));
    expect(periodRow(t)?.triggeredBy).toBe('facturar_ahora');
    expect(invoiceCount(t)).toBe(1);
  });

  for (const [label, status, code] of [
    ['AC-59: cancelado', 'cancelado', 'facturacion_cancelada'],
    ['AC-60: en curso', 'en_curso', 'facturacion_en_curso'],
    ['AC-60: ya realizada', 'completado', 'facturacion_realizada'],
  ] as const) {
    it(`${label}: una solicitud directa al endpoint se rechaza sin generar ninguna factura`, async () => {
      const t = billingApp();
      setPeriod(t, status);
      const { agent } = await loggedInAgent(t, { role: 'admin' });

      const res = await agent.post('/api/billing/current/bill-now');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(code);
      expect(invoiceCount(t)).toBe(0);
      expect(t.adapters.arca.requests).toHaveLength(0);
      expect(periodRow(t)?.status).toBe(status);
    });
  }
});

describe('cancelar y reactivar la facturación del período (RF-54, RF-56)', () => {
  it('RF-54, RF-56: un Admin cancela el período sin empezar y después lo reactiva', async () => {
    const t = billingApp();
    const { agent, user } = await loggedInAgent(t, { role: 'admin' });

    const cancelled = await agent.post('/api/billing/current/cancel');
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ status: 'cancelado', billNow: { enabled: false } });
    expect(periodRow(t)).toMatchObject({ status: 'cancelado', cancelledByUserId: user.id, cancelledAt: OCT_10 });

    const reactivated = await agent.post('/api/billing/current/reactivate');
    expect(reactivated.status).toBe(200);
    expect(reactivated.body).toMatchObject({ status: 'pendiente', billNow: { enabled: true, reason: null } });
    expect(periodRow(t)).toMatchObject({ status: 'pendiente', reactivatedByUserId: user.id });
  });

  it('AC-56: no se puede cancelar un período cuya facturación ya empezó', async () => {
    for (const status of ['en_curso', 'completado'] as const) {
      const t = billingApp();
      setPeriod(t, status);
      const { agent } = await loggedInAgent(t, { role: 'admin' });
      const res = await agent.post('/api/billing/current/cancel');
      expect(res.status, status).toBe(409);
      expect(res.body.error.code, status).toBe('facturacion_iniciada');
      expect(periodRow(t)?.status, status).toBe(status);
    }
  });

  it('no se puede reactivar un período que no está cancelado', async () => {
    const t = billingApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const res = await agent.post('/api/billing/current/reactivate');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('periodo_no_cancelado');
  });
});

describe('permisos (RF-10, RF-13)', () => {
  it('AC-216: un Editor o un usuario Consulta no puede cancelar, reactivar ni facturar ahora; el período no cambia y no hay facturas', async () => {
    for (const role of ['editor', 'consulta'] as const) {
      const t = billingApp();
      const { agent } = await loggedInAgent(t, { role });
      expect((await agent.post('/api/billing/current/bill-now')).status, role).toBe(403);
      expect((await agent.post('/api/billing/current/cancel')).status, role).toBe(403);
      expect(periodRow(t), role).toBeUndefined();

      setPeriod(t, 'cancelado');
      expect((await agent.post('/api/billing/current/reactivate')).status, role).toBe(403);
      expect(periodRow(t)?.status, role).toBe('cancelado');
      expect(invoiceCount(t), role).toBe(0);
    }
  });
});
