import type { Clock } from './types.ts';

/** Reloj real del sistema. Los tests usan un reloj falso con la misma interfaz. */
export const systemClock: Clock = { now: () => new Date() };
