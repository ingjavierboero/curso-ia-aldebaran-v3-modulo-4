import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { billingPeriods, invoices, settings } from '../../../src/db/schema.ts';
import { createBillingJob } from '../../../src/jobs/billing-job.ts';
import { createScheduler } from '../../../src/jobs/scheduler.ts';
import { BillingPeriodError, billNow, cancelBilling, reactivateBilling } from '../../../src/services/billing-periods.ts';
import { createTestApp, type TestApp } from '../../helpers/test-app.ts';
import { assignProduct, configureIssuer, insertClient, insertProduct, insertUser } from '../../helpers/test-db.ts';

/** Argentina es UTC-3 todo el año: las 11:00 de Argentina son las 14:00 UTC. */
const utc = (iso: string) => `${iso}:00.000Z`;

/** Sistema con un cliente facturable, el agente de facturación en el scheduler y un Admin. */
function setup(start = utc('2026-10-01T12:00')) {
  const t = createTestApp({ now: start });
  configureIssuer(t.db);
  const client = insertClient(t.db, { ivaCondition: 6 });
  assignProduct(t.db, client.id, insertProduct(t.db).id);
  const admin = insertUser(t.db, { role: 'admin' });
  const scheduler = createScheduler({
    enabled: true,
    clock: t.adapters.clock,
    processes: [createBillingJob(t.ctx)],
    schedule: vi.fn(),
  });
  /** Mueve el reloj y ejecuta el tick de ese minuto. */
  const tickAt = async (iso: string) => {
    t.adapters.clock.set(iso);
    await scheduler.tick();
  };
  return { t, admin, client, tickAt };
}

const invoicesOf = (t: TestApp, period: string) =>
  t.db.select().from(invoices).where(eq(invoices.period, period)).all();
const periodRow = (t: TestApp, period: string) =>
  t.db.select().from(billingPeriods).where(eq(billingPeriods.period, period)).get();

describe('arranque de la corrida del día 15 (RF-51, RNF-12)', () => {
  it('AC-52: la corrida se inicia a las 11:00 de Argentina del 15, y no un minuto antes', async () => {
    const { t, tickAt } = setup();
    await tickAt(utc('2026-10-14T14:00'));
    await tickAt(utc('2026-10-15T13:59')); // 10:59 en Argentina
    expect(invoicesOf(t, '2026-10')).toHaveLength(0);

    await tickAt(utc('2026-10-15T14:00')); // 11:00 en Argentina
    expect(invoicesOf(t, '2026-10')).toHaveLength(1);
    expect(periodRow(t, '2026-10')).toMatchObject({ status: 'completado', triggeredBy: 'agente_dia_15' });
  });

  it('AC-229: con el servidor en UTC no arranca a las 11:00 UTC (08:00 en Argentina) y sí a las 14:00 UTC', async () => {
    const { t, tickAt } = setup();
    await tickAt(utc('2026-10-15T11:00'));
    expect(invoicesOf(t, '2026-10')).toHaveLength(0);
    await tickAt(utc('2026-10-15T14:00'));
    expect(invoicesOf(t, '2026-10')).toHaveLength(1);
  });

  it('AC-61: con la hora de facturación en 14:00, arranca a las 14:00 de Argentina', async () => {
    const { t, tickAt } = setup();
    t.db.update(settings).set({ billingTime: '14:00' }).run();
    await tickAt(utc('2026-10-15T14:00')); // 11:00 en Argentina
    await tickAt(utc('2026-10-15T16:59')); // 13:59 en Argentina
    expect(invoicesOf(t, '2026-10')).toHaveLength(0);
    await tickAt(utc('2026-10-15T17:00')); // 14:00 en Argentina
    expect(invoicesOf(t, '2026-10')).toHaveLength(1);
  });

  it('la corrida se ejecuta una sola vez aunque el tick siga evaluándola cada minuto', async () => {
    const { t, tickAt } = setup();
    await tickAt(utc('2026-10-15T14:00'));
    await tickAt(utc('2026-10-15T14:01'));
    await tickAt(utc('2026-10-20T14:00'));
    expect(invoicesOf(t, '2026-10')).toHaveLength(1);
    expect(t.adapters.arca.requests).toHaveLength(1);
  });
});

describe('recuperación después de una caída (RF-52, RF-53)', () => {
  it('AC-53: si el sistema estuvo detenido el 15 y vuelve el 17/10 a las 09:00, la corrida arranca en ese mismo minuto', async () => {
    const { t, tickAt } = setup();
    await tickAt(utc('2026-10-17T12:00')); // primer tick al volver: 09:00 en Argentina
    expect(invoicesOf(t, '2026-10')).toHaveLength(1);
    expect(periodRow(t, '2026-10')?.triggeredBy).toBe('agente_recuperacion');
  });

  it('AC-53: si el sistema vuelve recién en noviembre, no se factura octubre', async () => {
    const { t, tickAt } = setup();
    await tickAt(utc('2026-11-01T12:00'));
    await tickAt(utc('2026-11-10T14:00'));
    expect(invoicesOf(t, '2026-10')).toHaveLength(0);
    expect(invoicesOf(t, '2026-11')).toHaveLength(0);
  });

  it('RF-53: un período en curso interrumpido el 31/10 se retoma el 01/11 con las fechas de ese día', async () => {
    const { t, tickAt } = setup();
    t.db
      .insert(billingPeriods)
      .values({ period: '2026-10', status: 'en_curso', triggeredBy: 'agente_dia_15', startedAt: utc('2026-10-31T14:00') })
      .run();

    await tickAt(utc('2026-11-01T12:00'));
    expect(invoicesOf(t, '2026-10')).toEqual([
      expect.objectContaining({ issueDate: '2026-11-01', serviceTo: '2026-10-31', dueDate: '2026-11-01' }),
    ]);
    expect(periodRow(t, '2026-10')?.status).toBe('completado');
  });
});

describe('cancelación y reactivación del período (RF-54 a RF-57)', () => {
  it('AC-55: un período cancelado el 10/10 no se factura el 15 ni al volver el 17', async () => {
    const { t, admin, tickAt } = setup();
    t.adapters.clock.set(utc('2026-10-10T13:00'));
    await cancelBilling(t.ctx, admin.id);

    await tickAt(utc('2026-10-15T14:00'));
    await tickAt(utc('2026-10-17T12:00'));
    expect(invoicesOf(t, '2026-10')).toHaveLength(0);
    expect(periodRow(t, '2026-10')).toMatchObject({ status: 'cancelado', cancelledByUserId: admin.id });
  });

  it('AC-57: al reactivar el 20/10 un período cancelado, la corrida arranca dentro del minuto', async () => {
    const { t, admin, tickAt } = setup();
    t.adapters.clock.set(utc('2026-10-10T13:00'));
    await cancelBilling(t.ctx, admin.id);
    await tickAt(utc('2026-10-15T14:00'));

    t.adapters.clock.set(utc('2026-10-20T13:00'));
    await reactivateBilling(t.ctx, admin.id);
    expect(periodRow(t, '2026-10')).toMatchObject({ reactivatedByUserId: admin.id });

    await tickAt(utc('2026-10-20T13:00'));
    expect(invoicesOf(t, '2026-10')).toHaveLength(1);
    expect(periodRow(t, '2026-10')).toMatchObject({ status: 'completado', triggeredBy: 'reactivacion' });
  });

  it('AC-57: el 01/11 ya no se puede reactivar la facturación de octubre', async () => {
    const { t, admin, tickAt } = setup();
    t.adapters.clock.set(utc('2026-10-10T13:00'));
    await cancelBilling(t.ctx, admin.id);

    t.adapters.clock.set(utc('2026-11-01T12:00'));
    await expect(reactivateBilling(t.ctx, admin.id)).rejects.toBeInstanceOf(BillingPeriodError);
    await tickAt(utc('2026-11-01T12:01'));
    expect(invoicesOf(t, '2026-10')).toHaveLength(0);
    expect(periodRow(t, '2026-10')?.status).toBe('cancelado');
  });
});

describe('"Facturar ahora" (RF-58, RF-59)', () => {
  it('AC-58: facturar el 05/10 emite con esa fecha, y el 15 no hay otra corrida: un cliente nuevo del 10/10 no recibe factura de octubre', async () => {
    const { t, admin, tickAt } = setup();
    t.adapters.clock.set(utc('2026-10-05T13:00'));
    await billNow(t.ctx, admin.id);
    expect(invoicesOf(t, '2026-10')).toEqual([expect.objectContaining({ issueDate: '2026-10-05' })]);
    expect(periodRow(t, '2026-10')).toMatchObject({ status: 'completado', triggeredBy: 'facturar_ahora' });

    t.adapters.clock.set(utc('2026-10-10T13:00'));
    const late = insertClient(t.db, { ivaCondition: 6 });
    assignProduct(t.db, late.id, insertProduct(t.db).id);

    await tickAt(utc('2026-10-15T14:00'));
    await tickAt(utc('2026-10-17T12:00'));
    expect(invoicesOf(t, '2026-10')).toHaveLength(1);
    expect(t.db.select().from(invoices).where(eq(invoices.clientId, late.id)).all()).toHaveLength(0);
  });
});
