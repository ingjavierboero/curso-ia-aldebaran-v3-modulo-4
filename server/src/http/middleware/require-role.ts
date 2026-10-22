import type { RequestHandler } from 'express';
import type { Role } from '../types.ts';
import { forbidden } from '../errors.ts';
import { currentUser } from './session.ts';

/**
 * Restringe una ruta a los perfiles indicados (RF-06 a RF-13). Cada ruta declara quién puede usarla:
 * por ejemplo, la gestión de usuarios solo Admin, y las modificaciones Admin y Editor. El perfil sale
 * del usuario de la sesión, leído de la base en cada solicitud.
 */
export function requireRole(...roles: Role[]): RequestHandler {
  return (_req, res, next) => {
    next(roles.includes(currentUser(res).role) ? undefined : forbidden());
  };
}

/** Atajos con los perfiles que permite cada tipo de acción del PRD. */
export const onlyAdmin = () => requireRole('admin');
/** Modificar registros: Admin y Editor (RF-10, RF-13). */
export const canEdit = () => requireRole('admin', 'editor');
