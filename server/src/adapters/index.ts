import type { Env } from '../config/env.ts';
import type { Db } from '../db/client.ts';
import { createMockArcaClient } from './arca/mock.ts';
import { systemClock } from './clock.ts';
import { mockClassifier } from './llm/mock.ts';
import { createMockMail } from './mail/mock-mailbox.ts';
import { createSmtpSender } from './mail/smtp-sender.ts';
import type { Adapters, Clock } from './types.ts';

/** Error de una implementación real que todavía no se construyó. */
export class AdapterNotImplementedError extends Error {}

/**
 * Reemplazo de una implementación real pendiente de su historia de usuario: cualquier llamada falla
 * con un error explícito en lugar de comportarse de forma silenciosa.
 */
function pending<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get(_target, property) {
      if (property === 'then') return undefined; // que no se confunda con una promesa
      if (property === 'address') return '';
      return () => Promise.reject(new AdapterNotImplementedError(`${name} todavía no está disponible.`));
    },
  });
}

/**
 * Arma los adapters según el modo, en un único lugar (Constitución, Principio V; research R-01).
 * En modo mock no se conecta a ARCA, Claude ni Gmail (RF-185, RF-187, RF-194).
 */
export function createAdapters(env: Env, db: Db, clock: Clock = systemClock): Adapters {
  // La cotización se lee de dolarhoy.com en ambos modos (PRD, Fuera de Alcance); llega en US3.
  const fx = pending<Adapters['fx']>('La lectura de la cotización');

  if (env.mode === 'mock') {
    const mail = createMockMail(db, clock);
    return {
      clock,
      arca: createMockArcaClient(db),
      classifier: mockClassifier,
      mailSender: mail.sender,
      mailbox: mail.mailbox,
      fx,
    };
  }

  return {
    clock,
    arca: pending<Adapters['arca']>('El cliente de ARCA homologación'), // US3
    classifier: pending<Adapters['classifier']>('El clasificador con Claude'), // US4
    mailSender: createSmtpSender(env),
    mailbox: pending<Adapters['mailbox']>('La lectura de la casilla por IMAP'), // US4
    fx,
  };
}
