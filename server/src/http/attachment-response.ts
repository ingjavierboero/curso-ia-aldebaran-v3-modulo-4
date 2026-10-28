import type { Response } from 'express';
import { detectFileType } from '../domain/file-signature.ts';

/**
 * CSP de toda respuesta con un adjunto (research R-16): `sandbox` impide que el archivo ejecute scripts
 * con el origen de la app aunque el navegador lo abra, y no carga nada externo.
 */
export const ATTACHMENT_CSP = "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'";

/**
 * Nombre de archivo apto para el header Content-Disposition: sin rutas y solo con letras, números, puntos,
 * guiones y espacios, así no se pueden inyectar comillas, saltos de línea ni otros headers.
 */
export function safeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? '';
  const clean = base
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 150);
  return clean || 'adjunto';
}

/**
 * Entrega un adjunto recibido como contenido no confiable (RNF-16, AC-255). Su formato se vuelve a
 * verificar por la firma: solo los PDF y las imágenes JPEG, PNG, GIF o WebP se muestran en el navegador;
 * cualquier otro archivo se entrega como descarga con un tipo genérico. Siempre con `nosniff`, CSP
 * `sandbox` y sin caché.
 */
export function sendAttachment(res: Response, attachment: { filename: string; content: Uint8Array }): void {
  const verified = detectFileType(attachment.content);
  const disposition = verified ? 'inline' : 'attachment';
  res.set({
    'Content-Type': verified ?? 'application/octet-stream',
    'Content-Disposition': `${disposition}; filename="${safeFilename(attachment.filename)}"`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': ATTACHMENT_CSP,
    'Cache-Control': 'private, no-store',
  });
  res.end(Buffer.from(attachment.content));
}
