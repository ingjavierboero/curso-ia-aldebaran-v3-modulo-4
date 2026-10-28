import { describe, expect, it } from 'vitest';
import { detectFileType } from '../../../src/domain/file-signature.ts';

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);
const concat = (...parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

describe('formato de un adjunto por su firma (RF-117, research R-16)', () => {
  it('detecta un PDF por "%PDF-"', () => {
    expect(detectFileType(text('%PDF-1.7\n%âãÏÓ\n1 0 obj'))).toBe('application/pdf');
  });

  it('detecta un PNG por sus 8 bytes iniciales', () => {
    expect(detectFileType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13))).toBe('image/png');
  });

  it('detecta un JPEG por FF D8 FF', () => {
    expect(detectFileType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46))).toBe('image/jpeg');
  });

  it('detecta un GIF por GIF87a y por GIF89a', () => {
    expect(detectFileType(text('GIF87a\x01\x00'))).toBe('image/gif');
    expect(detectFileType(text('GIF89a\x01\x00'))).toBe('image/gif');
  });

  it('detecta un WebP por RIFF....WEBP', () => {
    expect(detectFileType(concat(text('RIFF'), bytes(0x24, 0, 0, 0), text('WEBPVP8 ')))).toBe('image/webp');
  });

  it('AC-254: un HTML con un script no es de ningún formato aceptado, aunque se llame comprobante.pdf', () => {
    expect(detectFileType(text('<html><script>fetch("/api/users")</script></html>'))).toBeNull();
    expect(detectFileType(text('<!DOCTYPE html><html></html>'))).toBeNull();
  });

  it('un SVG (imagen con scripts posibles) no se acepta como imagen', () => {
    expect(detectFileType(text('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull();
    expect(detectFileType(text('<svg onload="alert(1)"></svg>'))).toBeNull();
  });

  it('un texto plano no es de ningún formato aceptado', () => {
    expect(detectFileType(text('Transferencia realizada por $15.000'))).toBeNull();
  });

  it('la firma tiene que estar al principio: "%PDF-" después de otro contenido no cuenta', () => {
    expect(detectFileType(text('<html>%PDF-1.7</html>'))).toBeNull();
    expect(detectFileType(text(' %PDF-1.7'))).toBeNull();
  });

  it('otros formatos con firma propia no se aceptan: .docx (ZIP), RIFF que no es WebP', () => {
    expect(detectFileType(bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0, 6, 0))).toBeNull();
    expect(detectFileType(concat(text('RIFF'), bytes(0x24, 0, 0, 0), text('WAVEfmt ')))).toBeNull();
  });

  it('un archivo vacío o más corto que cualquier firma da null', () => {
    expect(detectFileType(new Uint8Array(0))).toBeNull();
    expect(detectFileType(text('%PD'))).toBeNull();
    expect(detectFileType(bytes(0x89, 0x50, 0x4e))).toBeNull();
    expect(detectFileType(text('RIFF'))).toBeNull();
  });
});
