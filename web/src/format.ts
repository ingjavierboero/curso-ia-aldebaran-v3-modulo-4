/** Formatos de los datos en pantalla (plan.md, Diseño de la interfaz). */

/** CUIT con guiones: `20111111112` → `20-11111111-2`. Un valor que no tiene 11 dígitos queda igual. */
export function formatCuit(cuit: string): string {
  return /^\d{11}$/.test(cuit) ? `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}` : cuit;
}

const MONEY = {
  ARS: new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }),
  USD: new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD' }),
};

/** Monto en centavos con el símbolo de su moneda: `1500000, 'ARS'` → `$ 15.000,00`. */
export function formatMoney(cents: number, currency: 'ARS' | 'USD'): string {
  return MONEY[currency].format(cents / 100);
}

const DATE = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'America/Argentina/Buenos_Aires',
});

/**
 * Fecha como `DD/MM/AAAA`. Un timestamp se muestra en la hora de Argentina (RNF-12); una fecha civil
 * (`YYYY-MM-DD`) se muestra tal cual, sin pasar por ninguna zona horaria.
 */
export function formatDate(value: string): string {
  const civil = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (civil) return `${civil[3]}/${civil[2]}/${civil[1]}`;
  return DATE.format(new Date(value));
}

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

const monthOf = (period: string) => {
  const [year, month] = period.split('-').map(Number) as [number, number];
  return { year, name: MONTHS[month - 1] ?? '' };
};

/** Período `YYYY-MM` para listados: `2026-10` → "Octubre 2026". */
export function formatPeriod(period: string): string {
  const { year, name } = monthOf(period);
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
}

/** Período `YYYY-MM` dentro de una frase: `2026-10` → "octubre de 2026". */
export function formatPeriodLong(period: string): string {
  const { year, name } = monthOf(period);
  return `${name} de ${year}`;
}
