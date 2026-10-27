/**
 * Texto de un PDF generado con pdfkit, para verificar su contenido en los tests sin sumar una
 * dependencia: descomprime los flujos (zlib) y decodifica los textos que pdfkit escribe en hexadecimal
 * con la codificación WinAnsi de las fuentes estándar. Cada operación de texto queda en su línea;
 * pdfkit parte en varias operaciones el texto que no entra en el ancho, así que conviene normalizar
 * los espacios antes de buscar.
 */
import { inflateSync } from 'node:zlib';

const STREAM = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
/** `<hex> Tj` o `[<hex> 12 <hex>] TJ`: los números son ajustes de espaciado entre fragmentos. */
const TEXT_OP = /\[((?:\s*(?:<[0-9a-fA-F]*>|-?\d+(?:\.\d+)?))*)\s*\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g;
const HEX = /<([0-9a-fA-F]*)>/g;

const WIN_ANSI = new TextDecoder('windows-1252');
const decode = (hex: string) => WIN_ANSI.decode(Buffer.from(hex, 'hex'));

export function pdfText(pdf: Uint8Array): string {
  const raw = Buffer.from(pdf).toString('latin1');
  const lines: string[] = [];
  for (const [, body] of raw.matchAll(STREAM)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(body ?? '', 'latin1')).toString('latin1');
    } catch {
      content = body ?? ''; // flujo sin comprimir
    }
    for (const [, array, single] of content.matchAll(TEXT_OP)) {
      const fragments = array === undefined ? [single ?? ''] : [...array.matchAll(HEX)].map(([, hex]) => hex ?? '');
      lines.push(fragments.map(decode).join(''));
    }
  }
  return lines.join('\n');
}
