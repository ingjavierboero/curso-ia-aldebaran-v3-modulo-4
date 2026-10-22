import type { RequestHandler } from 'express';

/**
 * Headers de seguridad comunes (RNF-16, research R-16): el navegador no reinterpreta el tipo de lo que
 * recibe, la app no se puede embeber en otro sitio y no se filtra la URL a otros orígenes.
 */
export function securityHeaders(csp: string): RequestHandler {
  return (_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': csp,
    });
    next();
  };
}
