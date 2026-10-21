/**
 * Fechas y horas civiles de Argentina (RNF-12, research R-03). Se calculan con la zona horaria, sin
 * asumir un offset fijo ni depender de la zona del proceso.
 */
export const TIME_ZONE = 'America/Argentina/Buenos_Aires';

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export interface CivilParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Año, mes, día, hora y minuto de un instante en Argentina. */
export function argentinaParts(date: Date): CivilParts {
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** Fecha civil `YYYY-MM-DD` en Argentina. */
export function civilDate(date: Date): string {
  const { year, month, day } = argentinaParts(date);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Período `YYYY-MM` del mes en curso en Argentina. */
export function currentPeriod(date: Date): string {
  const { year, month } = argentinaParts(date);
  return `${year}-${pad(month)}`;
}

/** Último día del mes, como fecha civil `YYYY-MM-DD`. */
export function lastDayOfMonth(year: number, month: number): string {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** ¿El instante cae en el último día del mes en Argentina? (RF-149) */
export function isLastDayOfMonth(date: Date): boolean {
  const { year, month } = argentinaParts(date);
  return civilDate(date) === lastDayOfMonth(year, month);
}

/** Suma días a una fecha civil `YYYY-MM-DD`. */
export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number];
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return `${result.getUTCFullYear()}-${pad(result.getUTCMonth() + 1)}-${pad(result.getUTCDate())}`;
}

/** ¿Ya es la hora `HH:MM` configurada (o más tarde) en Argentina? Compara al minuto. */
export function isAtOrAfterTime(date: Date, time: string): boolean {
  const { hour, minute } = argentinaParts(date);
  const [configuredHour, configuredMinute] = time.split(':').map(Number) as [number, number];
  return hour * 60 + minute >= configuredHour * 60 + configuredMinute;
}
