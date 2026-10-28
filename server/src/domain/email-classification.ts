/** Clasificación de un adjunto o de un email con adjuntos (`error`: procesamiento erróneo, RNF-02). */
export type Classification = 'si' | 'no' | 'dudoso' | 'error';

/** Orden de RF-123: el primero que aparezca entre los adjuntos define la clasificación del email. */
const PRIORITY: readonly Classification[] = ['error', 'dudoso', 'si', 'no'];

/**
 * RF-123: una única clasificación para el email a partir de la de sus adjuntos. Un email sin adjuntos no
 * tiene clasificación (RF-115).
 */
export function classifyEmail(attachments: readonly Classification[]): Classification | null {
  return PRIORITY.find((kind) => attachments.includes(kind)) ?? null;
}
