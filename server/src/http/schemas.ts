import { z } from 'zod';
import { MIN_PASSWORD_LENGTH } from '../services/auth.ts';

/** Validaciones de entrada compartidas por varias rutas. */

/** RF-22: toda contraseña nueva tiene al menos 8 caracteres. */
export const newPassword = z
  .string({ error: 'La contraseña es obligatoria.' })
  .min(MIN_PASSWORD_LENGTH, `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);

export const email = z.string({ error: 'El email es obligatorio.' }).trim().pipe(z.email('El email no es válido.'));

export const requiredText = (label: string) =>
  z.string({ error: `${label} es obligatorio.` }).trim().min(1, `${label} es obligatorio.`);

/** Fecha civil `YYYY-MM-DD` que existe en el calendario (31/02 no). */
export const calendarDate = (message: string) =>
  z.string().refine((value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, m, d] = value.split('-').map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }, message);

/** Período `YYYY-MM` con un mes del 01 al 12 (data-model.md). */
export const period = (message: string) => z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, message);
