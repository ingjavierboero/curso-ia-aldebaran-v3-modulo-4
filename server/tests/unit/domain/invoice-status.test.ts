import { describe, expect, it } from 'vitest';
import {
  type InvoiceStatus,
  InvalidTransitionError,
  assertTransition,
  canTransition,
  reasonAfterTransition,
} from '../../../src/domain/invoice-status.ts';

const ALL: InvoiceStatus[] = ['generando', 'pendiente_de_pago', 'pago_recibido', 'revision_manual', 'pagada'];

/** Transiciones permitidas según data-model.md; cualquier otra se rechaza. */
const ALLOWED = {
  agente: [
    ['generando', 'pendiente_de_pago'],
    ['pendiente_de_pago', 'pago_recibido'],
    ['pendiente_de_pago', 'revision_manual'],
    ['revision_manual', 'revision_manual'],
  ],
  usuario: [
    ['pago_recibido', 'pagada'],
    ['pago_recibido', 'pendiente_de_pago'],
    ['revision_manual', 'pagada'],
    ['revision_manual', 'pendiente_de_pago'],
    ['pendiente_de_pago', 'pagada'],
  ],
} as const;

describe('transiciones de estado de las facturas (data-model.md)', () => {
  it('FR-026, Constitución III: el agente nunca puede pasar una factura a Pagada, desde ningún estado', () => {
    for (const from of ALL) {
      expect(canTransition(from, 'pagada', 'agente')).toBe(false);
      expect(() => assertTransition(from, 'pagada', 'agente')).toThrow(InvalidTransitionError);
    }
  });

  it('RF-134, RF-128 a RF-137: el agente solo pasa facturas a Pago recibido o Revisión manual', () => {
    for (const from of ALL) {
      for (const to of ALL) {
        const allowed = ALLOWED.agente.some(([f, t]) => f === from && t === to);
        expect(canTransition(from, to, 'agente'), `agente ${from} → ${to}`).toBe(allowed);
      }
    }
  });

  it('RF-143 a RF-147: el usuario decide sobre Pago recibido, Revisión manual y Pendiente de pago', () => {
    for (const from of ALL) {
      for (const to of ALL) {
        const allowed = ALLOWED.usuario.some(([f, t]) => f === from && t === to);
        expect(canTransition(from, to, 'usuario'), `usuario ${from} → ${to}`).toBe(allowed);
      }
    }
  });

  it('una factura Pagada no cambia más de estado', () => {
    for (const to of ALL) {
      expect(canTransition('pagada', to, 'agente')).toBe(false);
      expect(canTransition('pagada', to, 'usuario')).toBe(false);
    }
  });

  it('assertTransition acepta las transiciones permitidas y rechaza las demás', () => {
    expect(() => assertTransition('pendiente_de_pago', 'pago_recibido', 'agente')).not.toThrow();
    expect(() => assertTransition('pago_recibido', 'pagada', 'usuario')).not.toThrow();
    expect(() => assertTransition('pendiente_de_pago', 'revision_manual', 'usuario')).toThrow(InvalidTransitionError);
  });
});

describe('motivo de Revisión manual (RF-138, RF-140)', () => {
  it('RF-138: al pasar a Revisión manual la factura queda con el motivo de la regla', () => {
    expect(reasonAfterTransition('revision_manual', 'monto no coincide')).toBe('monto no coincide');
  });

  it('AC-151, RF-140: al salir de Revisión manual la factura deja de tener motivo', () => {
    expect(reasonAfterTransition('pagada', 'monto no coincide')).toBeNull();
    expect(reasonAfterTransition('pendiente_de_pago', 'monto no coincide')).toBeNull();
    expect(reasonAfterTransition('pago_recibido', null)).toBeNull();
  });

  it('una factura en Revisión manual siempre tiene motivo', () => {
    expect(() => reasonAfterTransition('revision_manual', null)).toThrow(InvalidTransitionError);
    expect(() => reasonAfterTransition('revision_manual', '')).toThrow(InvalidTransitionError);
  });
});
