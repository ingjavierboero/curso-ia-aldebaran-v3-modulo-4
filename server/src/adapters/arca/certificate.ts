import { readFileSync } from 'node:fs';
import forge from 'node-forge';
import type { CertificateStatus } from '../types.ts';

/** Lee el certificado PEM de ARCA y su clave privada (ARCA_CERT_PATH, ARCA_KEY_PATH). */
export function readCredentials(certPath: string, keyPath: string) {
  try {
    return {
      certificate: forge.pki.certificateFromPem(readFileSync(certPath, 'utf8')),
      key: forge.pki.privateKeyFromPem(readFileSync(keyPath, 'utf8')) as forge.pki.rsa.PrivateKey,
    };
  } catch {
    // Nunca se incluye el contenido de los archivos en el mensaje (Constitución IV).
    throw new Error('No se pudo leer el certificado o la clave de ARCA (ARCA_CERT_PATH, ARCA_KEY_PATH).');
  }
}

/** Estado del certificado para el banner (RF-97, RF-98): si se puede leer y cuándo vence. */
export function readCertificateStatus(certPath: string): CertificateStatus {
  try {
    const certificate = forge.pki.certificateFromPem(readFileSync(certPath, 'utf8'));
    return { readable: true, notAfter: certificate.validity.notAfter };
  } catch {
    return { readable: false, notAfter: null };
  }
}
