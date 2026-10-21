import type { CookieOptions, RequestHandler, Response } from 'express';
import type { AppContext } from '../../context.ts';
import { resolveSession, type User } from '../../services/sessions.ts';
import { unauthorized } from '../errors.ts';

export const SESSION_COOKIE = 'aldebaran_session';

/** Cookie de sesión: no accesible desde JavaScript y no enviada en solicitudes de otros sitios (research R-10). */
export const sessionCookieOptions: CookieOptions = { httpOnly: true, sameSite: 'lax', path: '/' };

/**
 * Endpoints que responden sin sesión (RF-01): estado inicial, registro del primer Admin, inicio de
 * sesión y recuperación de contraseña. Las rutas son relativas a `/api`.
 */
const PUBLIC_ROUTES: Array<{ method: string; path: RegExp }> = [
  { method: 'GET', path: /^\/setup$/ },
  { method: 'POST', path: /^\/setup\/first-admin$/ },
  { method: 'POST', path: /^\/auth\/login$/ },
  { method: 'POST', path: /^\/auth\/recovery$/ },
  { method: 'GET', path: /^\/auth\/recovery\/[^/]+$/ },
  { method: 'POST', path: /^\/auth\/recovery\/[^/]+$/ },
];

function isPublic(method: string, path: string): boolean {
  return PUBLIC_ROUTES.some((route) => route.method === method && route.path.test(path));
}

/** Lee una cookie del header `Cookie`, sin dependencias extra. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return undefined;
}

interface SessionLocals {
  user?: User;
  sessionToken?: string;
}

/** Usuario de la sesión actual; solo existe en rutas protegidas. */
export function currentUser(res: Response): User {
  const user = (res.locals as SessionLocals).user;
  if (!user) throw unauthorized();
  return user;
}

/** Token de la sesión actual, por ejemplo para no cerrarla al cambiar la contraseña (RF-21). */
export function currentSessionToken(res: Response): string {
  const token = (res.locals as SessionLocals).sessionToken;
  if (!token) throw unauthorized();
  return token;
}

/**
 * Exige una sesión válida para todo lo que está bajo `/api`, salvo los endpoints públicos (RF-01).
 * Se monta antes de los routers, así una ruta inexistente sin sesión también responde 401 y no
 * revela qué rutas existen (AC-211). El usuario se lee de la base en cada solicitud (AC-17).
 */
export function requireSession(ctx: AppContext): RequestHandler {
  return (req, res, next) => {
    if (isPublic(req.method, req.path)) return next();

    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    const user = token ? resolveSession(ctx.db, token, ctx.adapters.clock.now()) : null;
    if (!token || !user) return next(unauthorized());

    const locals = res.locals as SessionLocals;
    locals.user = user;
    locals.sessionToken = token;
    next();
  };
}
