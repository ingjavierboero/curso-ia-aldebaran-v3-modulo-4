import { eq } from 'drizzle-orm';
import forge from 'node-forge';
import type { Db } from '../../db/client.ts';
import { arcaTokens } from '../../db/schema.ts';
import type { Clock } from '../types.ts';
import { readCredentials } from './certificate.ts';
import { WSAA_URL } from './endpoints.ts';
import { ArcaCommunicationError, parseXml, path, postSoap, text } from './soap.ts';

const WSAA_NS = 'http://wsaa.view.sua.dvadac.desein.afip.gov';

/** No se usa un token que vence en menos de 5 minutos: podría vencer en medio de una operación. */
const TOKEN_MARGIN_MS = 5 * 60 * 1000;

export interface AccessTicket {
  token: string;
  sign: string;
}

export interface WsaaOptions {
  db: Db;
  certPath: string;
  keyPath: string;
  clock: Clock;
  fetchImpl: typeof fetch;
}

/** Fecha del TRA: ISO 8601 sin milisegundos y con la zona explícita, como pide WSAA. */
const traTime = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, '-00:00');

/** TRA (Ticket de Requerimiento de Acceso): válido desde 10 minutos antes hasta 12 horas después. */
export function buildTra(service: string, now: Date): string {
  const t = now.getTime();
  return (
    '<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header>' +
    `<uniqueId>${Math.floor(t / 1000)}</uniqueId>` +
    `<generationTime>${traTime(t - 10 * 60 * 1000)}</generationTime>` +
    `<expirationTime>${traTime(t + 12 * 60 * 60 * 1000)}</expirationTime>` +
    `</header><service>${service}</service></loginTicketRequest>`
  );
}

/** Firma el TRA como CMS (PKCS#7 SignedData, SHA-256) y devuelve el DER en base64. */
export function signTra(tra: string, certPath: string, keyPath: string, now: Date): string {
  const { certificate, key } = readCredentials(certPath, keyPath);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, 'utf8');
  p7.addCertificate(certificate);
  p7.addSigner({
    key,
    certificate,
    digestAlgorithm: forge.pki.oids.sha256 as string,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType as string, value: forge.pki.oids.data as string },
      { type: forge.pki.oids.messageDigest as string },
      // node-forge acepta una fecha aunque sus tipos declaren texto.
      { type: forge.pki.oids.signingTime as string, value: now as unknown as string },
    ],
  });
  p7.sign();
  return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

/**
 * Ticket de acceso de WSAA para un servicio (research R-06): usa el guardado en `arca_tokens` mientras
 * esté vigente, también después de un reinicio, y si no, pide uno nuevo y lo guarda.
 */
export function createWsaa(options: WsaaOptions) {
  async function login(service: string): Promise<AccessTicket & { expiresAt: string }> {
    const now = options.clock.now();
    const cms = signTra(buildTra(service, now), options.certPath, options.keyPath, now);
    const envelope =
      `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="${WSAA_NS}">` +
      `<soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms>` +
      '</soapenv:Body></soapenv:Envelope>';
    const response = await postSoap(WSAA_URL, '', envelope, options.fetchImpl);

    // El ticket viaja como XML escapado dentro de loginCmsReturn.
    const ticket = parseXml(text(path(response, 'Envelope', 'Body', 'loginCmsResponse', 'loginCmsReturn')));
    const token = text(path(ticket, 'loginTicketResponse', 'credentials', 'token'));
    const sign = text(path(ticket, 'loginTicketResponse', 'credentials', 'sign'));
    const expiration = text(path(ticket, 'loginTicketResponse', 'header', 'expirationTime'));
    if (!token || !sign || !expiration) {
      throw new ArcaCommunicationError('WSAA no devolvió un ticket de acceso válido.');
    }
    return { token, sign, expiresAt: new Date(expiration).toISOString() };
  }

  return {
    async getTicket(service: string): Promise<AccessTicket> {
      const cached = options.db.select().from(arcaTokens).where(eq(arcaTokens.service, service)).get();
      const now = options.clock.now().getTime();
      if (cached && new Date(cached.expiresAt).getTime() - TOKEN_MARGIN_MS > now) {
        return { token: cached.token, sign: cached.sign };
      }
      const ticket = await login(service);
      options.db
        .insert(arcaTokens)
        .values({ service, ...ticket })
        .onConflictDoUpdate({ target: arcaTokens.service, set: ticket })
        .run();
      return { token: ticket.token, sign: ticket.sign };
    },
  };
}
