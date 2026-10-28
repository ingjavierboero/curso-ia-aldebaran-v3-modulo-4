/** Formatos de adjunto aceptados como posible comprobante (RF-117). */
export type VerifiedFileType = 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

const ascii = (value: string) => [...value].map((char) => char.charCodeAt(0));

/** ¿El contenido tiene esos bytes a partir de `offset`? */
function startsWith(content: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return content.length >= offset + signature.length && signature.every((byte, i) => content[offset + i] === byte);
}

const PDF = ascii('%PDF-');
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const GIF87 = ascii('GIF87a');
const GIF89 = ascii('GIF89a');
const RIFF = ascii('RIFF');
const WEBP = ascii('WEBP');

/**
 * Formato real de un archivo por su firma inicial (RF-117, research R-16), sin mirar el tipo ni la
 * extensión que declara el email: un HTML, un SVG o cualquier otro contenido da null aunque diga ser PDF
 * o imagen. Es lo que impide servir un adjunto malicioso como si fuera un comprobante (RNF-16).
 */
export function detectFileType(content: Uint8Array): VerifiedFileType | null {
  if (startsWith(content, PDF)) return 'application/pdf';
  if (startsWith(content, PNG)) return 'image/png';
  if (startsWith(content, JPEG)) return 'image/jpeg';
  if (startsWith(content, GIF87) || startsWith(content, GIF89)) return 'image/gif';
  // RIFF, 4 bytes de tamaño y "WEBP".
  if (startsWith(content, RIFF) && startsWith(content, WEBP, 8)) return 'image/webp';
  return null;
}
