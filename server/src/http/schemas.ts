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
