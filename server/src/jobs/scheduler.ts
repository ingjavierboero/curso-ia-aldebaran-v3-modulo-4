import cron from 'node-cron';
import type { Clock } from '../adapters/types.ts';
import { TIME_ZONE } from '../domain/billing-dates.ts';

/**
 * Proceso automático que el tick evalúa cada minuto (research R-04): facturación, recordatorios,
 * revisión de la casilla y cola de reintentos. Cada historia agrega el suyo.
 */
export interface ScheduledProcess {
  name: string;
  /** ¿Le toca ejecutarse ahora, según el reloj de Argentina y el estado guardado? */
  shouldRun(now: Date): boolean | Promise<boolean>;
  run(now: Date): Promise<void>;
}

type ScheduleFn = (expression: string, task: () => void, options: { timezone: string }) => unknown;

export interface SchedulerOptions {
  /** SCHEDULER_ENABLED: si es false, el tick no se registra (AGENTS.md). */
  enabled: boolean;
  clock: Clock;
  processes: ScheduledProcess[];
  /** Se inyecta en los tests; por defecto usa node-cron. */
  schedule?: ScheduleFn;
  onError?: (processName: string, error: unknown) => void;
}

const defaultSchedule: ScheduleFn = (expression, task, options) => cron.schedule(expression, task, options);

function defaultOnError(processName: string, error: unknown) {
  // Solo el tipo de error: el mensaje podría incluir datos sensibles (Constitución IV).
  console.error(`El proceso automático "${processName}" falló: ${error instanceof Error ? error.name : typeof error}`);
}

export function createScheduler(options: SchedulerOptions) {
  const running = new Set<string>();
  const onError = options.onError ?? defaultOnError;
  let task: { stop?: () => void } | undefined;

  /**
   * Evalúa todos los procesos con la hora actual. Un proceso no se vuelve a iniciar mientras su
   * ejecución anterior siga en curso (RF-102), no frena a los demás y sus fallas no cortan el tick.
   */
  async function tick(): Promise<void> {
    const now = options.clock.now();
    const executions = options.processes
      .filter((process) => !running.has(process.name))
      .map(async (process) => {
        running.add(process.name);
        try {
          if (await process.shouldRun(now)) await process.run(now);
        } catch (error) {
          onError(process.name, error);
        } finally {
          running.delete(process.name);
        }
      });
    await Promise.all(executions);
  }

  return {
    tick,
    /** Registra un tick por minuto en la hora de Argentina (RNF-12), si el scheduler está habilitado. */
    start() {
      if (!options.enabled) return;
      const schedule = options.schedule ?? defaultSchedule;
      task = schedule('* * * * *', () => void tick(), { timezone: TIME_ZONE }) as { stop?: () => void };
    },
    stop() {
      task?.stop?.();
      task = undefined;
    },
  };
}
