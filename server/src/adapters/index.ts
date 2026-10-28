import type { Env } from '../config/env.ts';
import type { Db } from '../db/client.ts';
import { createMockArcaClient } from './arca/mock.ts';
import { createArcaHomologationClient } from './arca/wsfev1.ts';
import { systemClock } from './clock.ts';
import { createDolarhoySource } from './fx/dolarhoy.ts';
import { createAnthropicClassifier } from './llm/anthropic.ts';
import { mockClassifier } from './llm/mock.ts';
import { createImapMailbox } from './mail/imap-mailbox.ts';
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
  // La cotización se lee de dolarhoy.com en ambos modos (PRD, Fuera de Alcance; research R-13).
  const fx = createDolarhoySource();

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
    // Solo homologación (Constitución V); env.ts exige el certificado y la clave en este modo.
    arca: createArcaHomologationClient({
      cuit: env.arcaCuit,
      certPath: env.arcaCertPath ?? '',
      keyPath: env.arcaKeyPath ?? '',
      db,
      clock,
    }),
    classifier: createAnthropicClassifier(env.anthropicApiKey ?? ''),
    mailSender: createSmtpSender(env),
    mailbox: createImapMailbox({ user: env.gmailUser ?? '', appPassword: env.gmailAppPassword ?? '' }),
    fx,
  };
}
