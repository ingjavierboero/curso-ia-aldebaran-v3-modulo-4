import { describe, expect, it, vi } from 'vitest';
import { type ScheduledProcess, createScheduler } from '../../../src/jobs/scheduler.ts';
import { fixedClock } from '../../helpers/fakes.ts';

const clock = () => fixedClock('2026-10-15T14:00:00Z');

/** Deja correr las promesas pendientes (los procesos que ya terminaron). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function process(name: string, run: () => Promise<void> = async () => {}, shouldRun = () => true): ScheduledProcess {
  return { name, shouldRun: vi.fn(shouldRun), run: vi.fn(run) };
}

describe('registro del tick (research R-04)', () => {
  it('con el scheduler deshabilitado (SCHEDULER_ENABLED distinto de "true") no registra el tick', () => {
    const schedule = vi.fn();
    createScheduler({ enabled: false, clock: clock(), processes: [], schedule }).start();
    expect(schedule).not.toHaveBeenCalled();
  });

  it('habilitado registra un tick por minuto en la zona horaria de Argentina (RNF-12)', () => {
    const schedule = vi.fn(() => ({ stop: vi.fn() }));
    createScheduler({ enabled: true, clock: clock(), processes: [], schedule }).start();
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith('* * * * *', expect.any(Function), {
      timezone: 'America/Argentina/Buenos_Aires',
    });
  });

  it('stop detiene la tarea registrada', () => {
    const stop = vi.fn();
    const scheduler = createScheduler({ enabled: true, clock: clock(), processes: [], schedule: () => ({ stop }) });
    scheduler.start();
    scheduler.stop();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

describe('tick', () => {
  it('ejecuta cada proceso solo si shouldRun lo indica, con la hora del reloj', async () => {
    const yes = process('si');
    const no = process('no', async () => {}, () => false);
    const fixed = clock();
    await createScheduler({ enabled: true, clock: fixed, processes: [yes, no], schedule: vi.fn() }).tick();

    expect(yes.shouldRun).toHaveBeenCalledWith(fixed.now());
    expect(yes.run).toHaveBeenCalledWith(fixed.now());
    expect(no.run).not.toHaveBeenCalled();
  });

  it('RF-102: no inicia un proceso mientras su ejecución anterior sigue en curso, sin frenar a los demás', async () => {
    let finishSlow!: () => void;
    const slow = process('lento', () => new Promise<void>((resolve) => (finishSlow = resolve)));
    const fast = process('rapido');
    const scheduler = createScheduler({ enabled: true, clock: clock(), processes: [slow, fast], schedule: vi.fn() });

    const firstTick = scheduler.tick();
    await settle();
    expect(slow.run).toHaveBeenCalledTimes(1);
    expect(fast.run).toHaveBeenCalledTimes(1);

    // El proceso lento sigue corriendo: el segundo tick lo saltea, pero el rápido corre de nuevo.
    await scheduler.tick();
    expect(slow.run).toHaveBeenCalledTimes(1);
    expect(fast.run).toHaveBeenCalledTimes(2);

    // Cuando termina, el siguiente tick lo vuelve a ejecutar.
    finishSlow();
    await firstTick;
    const thirdTick = scheduler.tick();
    await settle();
    expect(slow.run).toHaveBeenCalledTimes(2);
    finishSlow();
    await thirdTick;
  });

  it('un proceso que falla no impide que corran los demás y se informa el error', async () => {
    const onError = vi.fn();
    const failing = process('falla', async () => Promise.reject(new Error('ARCA no responde')));
    const ok = process('ok');
    const scheduler = createScheduler({ enabled: true, clock: clock(), processes: [failing, ok], schedule: vi.fn(), onError });

    await scheduler.tick();
    expect(ok.run).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('falla', expect.any(Error));

    // Después de fallar, el proceso puede volver a ejecutarse en el siguiente tick.
    await scheduler.tick();
    expect(failing.run).toHaveBeenCalledTimes(2);
  });
});
