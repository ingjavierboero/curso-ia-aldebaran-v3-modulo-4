import type { FormRule } from 'antd';
import { ApiError } from './api/client.ts';

/** Largo mínimo de toda contraseña (RF-22); el server lo vuelve a validar. */
export const MIN_PASSWORD_LENGTH = 8;

export const newPasswordRules: FormRule[] = [
  { required: true, message: 'La contraseña es obligatoria.' },
  { min: MIN_PASSWORD_LENGTH, message: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` },
];

export const emailRules: FormRule[] = [
  { required: true, message: 'El email es obligatorio.' },
  { type: 'email', message: 'El email no es válido.' },
];

/** Mensaje para mostrarle al usuario a partir de un error de la API o de la red. */
export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Ocurrió un error inesperado.';
}

/** Aviso que una pantalla le pasa al login al redirigir, por ejemplo tras cambiar la contraseña. */
export interface LoginNotice {
  notice?: string;
  from?: string;
}
