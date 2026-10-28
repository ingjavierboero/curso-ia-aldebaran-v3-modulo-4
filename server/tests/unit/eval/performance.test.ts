/**
 * Escenarios del script de rendimiento (AC-232 a AC-234): se prueban con los adapters fake, así el test
 * no llama a ARCA, a Gmail ni a Claude (AGENTS.md); el script los corre con los servicios reales.
 */
import { describe, expect, it } from 'vitest';
import { invoices, receivedEmails, sentEmails } from '../../../src/db/schema.ts';
import {
  BATCH_LIMIT_MS,
  EMAIL_LIMIT_MS,
  percentile,
  runBillingScenario,
  runEmailsScenario,
  runRemindersScenario,
} from '../../../scripts/eval/performance-scenarios.ts';
import { createTestApp } from '../../helpers/test-app.ts';

const PDF = new TextEncoder().encode('%PDF-1.4 comprobante');

describe('percentil (nearest-rank)', () => {
  it('el p95 de 1 a 100 es 95, y el de un solo valor es ese valor', () => {
    expect(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 0.95)).toBe(95);
    expect(percentile([42], 0.95)).toBe(42);
    expect(percentile([5, 1, 3], 0.5)).toBe(3);
  });

  it('sin valores no hay percentil', () => {
    expect(() => percentile([], 0.95)).toThrow();
  });
});

describe('escenarios de rendimiento', () => {
  it('AC-233: 50 clientes con 2 productos de un catálogo de 10 generan 50 facturas y 50 emails', async () => {
    const t = createTestApp({ now: '2026-10-15T14:00:00.000Z' });

    const result = await runBillingScenario(t.ctx, { clients: 50, pointOfSale: 3 });

    expect(t.db.select().from(invoices).all().filter((i) => i.status === 'pendiente_de_pago')).toHaveLength(50);
    expect(t.adapters.arca.requests).toHaveLength(50);
    expect(t.adapters.mailSender.sent).toHaveLength(50);
    expect(result).toMatchObject({ name: 'facturación', items: 50, ok: 50, limitMs: BATCH_LIMIT_MS, passed: true });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('AC-234: 50 clientes con deuda reciben 50 recordatorios', async () => {
    const t = createTestApp({ now: '2026-10-31T14:00:00.000Z' });

    const result = await runRemindersScenario(t.ctx, { clients: 50 });

    expect(t.db.select().from(sentEmails).all().filter((e) => e.kind === 'recordatorio')).toHaveLength(50);
    expect(result).toMatchObject({ name: 'recordatorios', items: 50, ok: 50, passed: true });
  });

  it('AC-232: mide cada email desde que se detecta hasta que queda registrado y calcula el p95', async () => {
    const t = createTestApp({ now: '2026-10-20T14:00:00.000Z' });
    t.adapters.classifier.fallback = { kind: 'si', cuit: null, amountRaw: null };

    const result = await runEmailsScenario(t.ctx, {
      emails: 10,
      attachment: (i) => ({ filename: `comprobante-${i}.pdf`, mimeType: 'application/pdf', content: PDF }),
    });

    expect(t.db.select().from(receivedEmails).all()).toHaveLength(10);
    expect(t.adapters.classifier.calls).toHaveLength(10);
    expect(result).toMatchObject({ name: 'emails', items: 10, ok: 10, limitMs: EMAIL_LIMIT_MS, passed: true });
    expect(result.p95Ms).toBeGreaterThanOrEqual(0);
  });

  it('un escenario que no completa todos los ítems no aprueba, aunque sea rápido', async () => {
    const t = createTestApp({ now: '2026-10-31T14:00:00.000Z' });
    t.adapters.mailSender.steps.push(new Error('Gmail rechazó el envío'));

    const result = await runRemindersScenario(t.ctx, { clients: 3 });

    expect(result).toMatchObject({ items: 3, ok: 2, passed: false });
  });
});
