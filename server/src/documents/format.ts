/** Formatos de Argentina para los documentos que reciben los clientes: PDF y emails. */

import { TIME_ZONE } from '../domain/billing-dates.ts';

const MONEY = {
  ARS: new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }),
  USD: new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD' }),
};

/** Centavos con el símbolo de la moneda: 1500000 → "$ 15.000,00"; en dólares, "US$ 30,00". */
export const formatMoney = (cents: number, currency: 'ARS' | 'USD' = 'ARS') => MONEY[currency].format(cents / 100);

/** Fecha civil `YYYY-MM-DD` → `DD/MM/AAAA`. */
export function formatDate(date: string): string {
  const [year, month, day] = date.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

const DATE_TIME = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: TIME_ZONE,
});

/** Instante ISO → fecha `DD/MM/AAAA` en la hora de Argentina (RNF-12). */
export const formatInstantDate = (iso: string) => DATE_TIME.format(new Date(iso));

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

/** Período `YYYY-MM` → "octubre de 2026". */
export function formatPeriod(period: string): string {
  const [year, month] = period.split('-').map(Number) as [number, number];
  return `${MONTHS[month - 1]} de ${year}`;
}

/** CUIT con guiones: 20111111112 → "20-11111111-2". */
export const formatCuit = (cuit: string) =>
  /^\d{11}$/.test(cuit) ? `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}` : cuit;

/** Punto de venta y número de comprobante como los muestra ARCA: "00003-00000001". */
export const formatVoucherNumber = (pointOfSale: number, number: number) =>
  `${String(pointOfSale).padStart(5, '0')}-${String(number).padStart(8, '0')}`;
