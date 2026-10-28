import { join } from 'node:path';
import { createAdapters } from './adapters/index.ts';
import { createApp } from './app.ts';
import { loadEnv, REPO_ROOT } from './config/env.ts';
import type { AppContext } from './context.ts';
import { openDatabase } from './db/client.ts';
import { TIME_ZONE } from './domain/billing-dates.ts';
import { createBillingJob } from './jobs/billing-job.ts';
import { createMailboxJob } from './jobs/mailbox-job.ts';
import { createRemindersJob } from './jobs/reminders-job.ts';
import { createScheduler } from './jobs/scheduler.ts';

// Todos los horarios del sistema se rigen por la hora de Argentina (RNF-12).
process.env.TZ = TIME_ZONE;

/** Arranque: env → modo y base → adapters → app → scheduler. */
function main() {
  const env = loadEnv();
  const db = openDatabase(env.databasePath);
  const adapters = createAdapters(env, db);
  const ctx: AppContext = { db, env, adapters };

  // Con la web compilada (`npm run build`), el server también la sirve (`npm start`, research R-16).
  const app = createApp(ctx, { webDir: join(REPO_ROOT, 'web', 'dist') });
  // Cada historia suma acá su proceso automático (los reintentos llegan con US7).
  // Un período que quedó en curso por un reinicio se retoma en el primer tick (research R-04).
  const scheduler = createScheduler({
    enabled: env.schedulerEnabled,
    clock: adapters.clock,
    processes: [createBillingJob(ctx), createRemindersJob(ctx), createMailboxJob(ctx)],
  });

  const server = app.listen(env.port, () => {
    const mode = env.mode === 'mock' ? 'modo mock (ARCA, LLM y email simulados)' : 'modo homologación';
    console.log(`Aldebaran escucha en el puerto ${env.port}, en ${mode}.`);
    if (!env.schedulerEnabled) console.log('Los procesos automáticos están apagados (SCHEDULER_ENABLED distinto de "true").');
  });
  scheduler.start();

  const shutdown = () => {
    scheduler.stop();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

try {
  main();
} catch (error) {
  // Configuración inválida: el sistema no arranca e informa el motivo (RF-213). Los mensajes de
  // configuración nombran variables pero nunca muestran sus valores (Constitución IV).
  console.error(`No se pudo arrancar Aldebaran: ${error instanceof Error ? error.message : 'error desconocido'}`);
  process.exit(1);
}
