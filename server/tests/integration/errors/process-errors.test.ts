import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { clientEvents, processErrors } from '../../../src/db/schema.ts';
import { recordProcessError } from '../../../src/services/process-errors.ts';
import { createTestDb, insertClient } from '../../helpers/test-db.ts';

const NOW = new Date('2026-10-15T14:00:00.000Z');

describe('alta de errores de proceso Pendientes (RF-174)', () => {
  it('registra la operación, los intentos, el último mensaje, el cliente y el período, en estado Pendiente', () => {
    const db = createTestDb();
    const client = insertClient(db);

    const error = recordProcessError(db, {
      operation: 'generacion_factura',
      clientId: client.id,
      period: '2026-10',
      attempts: 4,
      message: 'ARCA no respondió en 30 s.',
      now: NOW,
    });

    expect(db.select().from(processErrors).all()).toEqual([
      expect.objectContaining({
        id: error.id,
        operation: 'generacion_factura',
        clientId: client.id,
        period: '2026-10',
        invoiceId: null,
        attempts: 4,
        lastErrorMessage: 'ARCA no respondió en 30 s.',
        status: 'pendiente',
        createdAt: NOW.toISOString(),
      }),
    ]);
  });

  it('RF-163: el error de un cliente queda en su historial, registrado por el agente', () => {
    const db = createTestDb();
    const client = insertClient(db);
    recordProcessError(db, { operation: 'generacion_factura', clientId: client.id, period: '2026-10', attempts: 1, message: 'falla', now: NOW });

    expect(db.select().from(clientEvents).where(eq(clientEvents.clientId, client.id)).all()).toEqual([
      expect.objectContaining({
        type: 'error_proceso',
        actorType: 'agente',
        occurredAt: NOW.toISOString(),
        payload: expect.objectContaining({ operation: 'generacion_factura', period: '2026-10', message: 'falla' }),
      }),
    ]);
  });

  it('un error de la misma operación, cliente y período que sigue Pendiente se actualiza en vez de duplicarse', () => {
    const db = createTestDb();
    const client = insertClient(db);
    const base = { operation: 'generacion_factura' as const, clientId: client.id, period: '2026-10' };
    const first = recordProcessError(db, { ...base, attempts: 1, message: 'primera falla', now: NOW });
    const later = new Date(NOW.getTime() + 60_000);
    const second = recordProcessError(db, { ...base, attempts: 1, message: 'segunda falla', now: later });

    expect(second.id).toBe(first.id);
    expect(db.select().from(processErrors).all()).toEqual([
      expect.objectContaining({ attempts: 2, lastErrorMessage: 'segunda falla', updatedAt: later.toISOString() }),
    ]);
  });

  it('errores de otro período o de otro cliente se registran por separado', () => {
    const db = createTestDb();
    const a = insertClient(db);
    const b = insertClient(db);
    recordProcessError(db, { operation: 'generacion_factura', clientId: a.id, period: '2026-10', attempts: 1, message: 'x', now: NOW });
    recordProcessError(db, { operation: 'generacion_factura', clientId: a.id, period: '2026-11', attempts: 1, message: 'x', now: NOW });
    recordProcessError(db, { operation: 'generacion_factura', clientId: b.id, period: '2026-10', attempts: 1, message: 'x', now: NOW });
    expect(db.select().from(processErrors).all()).toHaveLength(3);
  });
});
