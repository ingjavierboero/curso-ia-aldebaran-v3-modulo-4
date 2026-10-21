/**
 * Instante correspondiente a una fecha y hora de Argentina, para escribir tests legibles:
 * `ar('2026-10-15T11:00')`. Argentina usa UTC-3 sin horario de verano.
 */
export function ar(localDateTime: string): Date {
  const withSeconds = localDateTime.length === 16 ? `${localDateTime}:00` : localDateTime;
  return new Date(`${withSeconds}-03:00`);
}
