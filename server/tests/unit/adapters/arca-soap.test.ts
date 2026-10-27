import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import forge from 'node-forge';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { WSAA_URL, WSFEV1_URL } from '../../../src/adapters/arca/endpoints.ts';
import { createArcaHomologationClient } from '../../../src/adapters/arca/wsfev1.ts';
import { ArcaRejectionError, type CaeRequest, TimeoutError } from '../../../src/adapters/types.ts';
import { arcaTokens } from '../../../src/db/schema.ts';
import { fixedClock } from '../../helpers/fakes.ts';
import { createTestDb } from '../../helpers/test-db.ts';

// ------------------------------------------------------------------ Certificado de prueba

/** Certificado autofirmado y su clave, en un directorio temporal: nunca salen del test. */
const keys = forge.pki.rsa.generateKeyPair(1024);
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = '0a1b2c';
cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
cert.validity.notAfter = new Date('2028-01-01T00:00:00Z');
cert.setSubject([{ name: 'commonName', value: 'aldebaran-test' }]);
cert.setIssuer([{ name: 'commonName', value: 'aldebaran-test' }]);
cert.sign(keys.privateKey, forge.md.sha256.create());

const dir = mkdtempSync(join(tmpdir(), 'aldebaran-arca-'));
const certPath = join(dir, 'arca.crt');
const keyPath = join(dir, 'arca.key');
writeFileSync(certPath, forge.pki.certificateToPem(cert));
writeFileSync(keyPath, forge.pki.privateKeyToPem(keys.privateKey));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.useRealTimers());

const CUIT = '20111111112';
const NOW = '2026-10-15T14:00:00.000Z';

// ------------------------------------------------------------------ Respuestas de ARCA

const soap = (body: string) =>
  `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;

const loginResponse = (expiration: string) =>
  soap(
    '<loginCmsResponse xmlns="http://wsaa.view.sua.dvadac.desein.afip.gov"><loginCmsReturn>' +
      '&lt;?xml version="1.0" encoding="UTF-8" standalone="yes"?&gt;&lt;loginTicketResponse version="1.0"&gt;' +
      `&lt;header&gt;&lt;expirationTime&gt;${expiration}&lt;/expirationTime&gt;&lt;/header&gt;` +
      '&lt;credentials&gt;&lt;token&gt;TOKEN-123&lt;/token&gt;&lt;sign&gt;SIGN-456&lt;/sign&gt;&lt;/credentials&gt;' +
      '&lt;/loginTicketResponse&gt;</loginCmsReturn></loginCmsResponse>',
  );

const lastNumberResponse = (number: number) =>
  soap(
    '<FECompUltimoAutorizadoResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompUltimoAutorizadoResult>' +
      `<PtoVta>3</PtoVta><CbteTipo>11</CbteTipo><CbteNro>${number}</CbteNro>` +
      '</FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse>',
  );

const caeResponse = (detail: string, errors = '') =>
  soap(
    '<FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECAESolicitarResult>' +
      '<FeCabResp><Cuit>20111111112</Cuit><PtoVta>3</PtoVta><CbteTipo>11</CbteTipo></FeCabResp>' +
      `<FeDetResp><FECAEDetResponse><Concepto>2</Concepto><DocTipo>80</DocTipo><DocNro>30711111111</DocNro>${detail}</FECAEDetResponse></FeDetResp>` +
      `${errors}</FECAESolicitarResult></FECAESolicitarResponse>`,
  );

const APPROVED = caeResponse('<Resultado>A</Resultado><CAE>76123456789012</CAE><CAEFchVto>20261025</CAEFchVto>');
const REJECTED = caeResponse(
  '<Resultado>R</Resultado><CAE></CAE><CAEFchVto></CAEFchVto>' +
    '<Observaciones><Obs><Code>10015</Code><Msg>El campo DocNro no corresponde a un CUIT valido.</Msg></Obs></Observaciones>',
);

const voucherResponse = (result: string) =>
  soap(
    `<FECompConsultarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompConsultarResult>${result}</FECompConsultarResult></FECompConsultarResponse>`,
  );
const FOUND = voucherResponse(
  '<ResultGet><Concepto>2</Concepto><DocTipo>80</DocTipo><DocNro>30711111111</DocNro><CbteDesde>7</CbteDesde>' +
    '<CbteFch>20261015</CbteFch><ImpTotal>201600.5</ImpTotal><CodAutorizacion>76123456789012</CodAutorizacion>' +
    '<FchVto>20261025</FchVto><Resultado>A</Resultado></ResultGet>',
);
const NOT_FOUND = voucherResponse(
  '<Errors><Err><Code>602</Code><Msg>No existen datos en nuestros registros para los parametros ingresados.</Msg></Err></Errors>',
);

// ------------------------------------------------------------------ fetch simulado

interface Call {
  url: string;
  action: string;
  body: string;
}

/** fetch que responde según la URL y la operación SOAP, y registra cada llamada. */
function fakeArcaFetch(responses: Partial<Record<string, string>>) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const action = (headers.get('SOAPAction') ?? '').replace(/"/g, '');
    const body = String(init?.body ?? '');
    calls.push({ url: String(url), action, body });
    const key = String(url) === WSAA_URL ? 'loginCms' : action.split('/').pop() ?? '';
    return new Response(responses[key] ?? '', { status: responses[key] ? 200 : 500 });
  });
  return { fetchImpl, calls };
}

const ALL_OK = {
  loginCms: loginResponse('2026-10-16T02:00:00.000-03:00'),
  FECompUltimoAutorizado: lastNumberResponse(41),
  FECAESolicitar: APPROVED,
  FECompConsultar: FOUND,
};

function client(fetchImpl: typeof fetch, db = createTestDb(), clock = fixedClock(NOW)) {
  return { arca: createArcaHomologationClient({ cuit: CUIT, certPath, keyPath, db, clock, fetchImpl }), db, clock };
}

/** Contenido de la primera etiqueta con ese nombre, con o sin prefijo. */
const tag = (xml: string, name: string) =>
  new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(xml)?.[1];

const REQUEST: CaeRequest = {
  pointOfSale: 3,
  voucherType: 11,
  number: 42,
  issueDate: '2026-10-15',
  serviceFrom: '2026-10-01',
  serviceTo: '2026-10-31',
  dueDate: '2026-10-31',
  receiverCuit: '30711111111',
  receiverIvaCondition: 6,
  totalCents: 20_160_050,
};

// ------------------------------------------------------------------ Tests

describe('autenticación con WSAA (research R-06)', () => {
  it('AC-227: firma el TRA de wsfe como CMS con el certificado y la clave de las variables de entorno', async () => {
    const { fetchImpl, calls } = fakeArcaFetch(ALL_OK);
    await client(fetchImpl).arca.lastAuthorizedNumber(3, 11);

    const login = calls[0];
    expect(login?.url).toBe(WSAA_URL);
    const cms = tag(login?.body ?? '', 'in0') ?? '';
    const message = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(forge.util.decode64(cms))) as forge.pkcs7.PkcsSignedData & {
      rawCapture: { content: forge.asn1.Asn1 };
    };
    expect(message.certificates[0]?.serialNumber).toBe('0a1b2c');
    const tra = forge.asn1.toDer(message.rawCapture.content).getBytes();
    expect(tra).toContain('<loginTicketRequest');
    expect(tra).toContain('<service>wsfe</service>');
  });

  it('AC-227: las operaciones de WSFEv1 usan el token, el sign y el ARCA_CUIT', async () => {
    const { fetchImpl, calls } = fakeArcaFetch(ALL_OK);
    await client(fetchImpl).arca.lastAuthorizedNumber(3, 11);

    const wsfe = calls[1];
    expect(wsfe?.url).toBe(WSFEV1_URL);
    expect(tag(wsfe?.body ?? '', 'Token')).toBe('TOKEN-123');
    expect(tag(wsfe?.body ?? '', 'Sign')).toBe('SIGN-456');
    expect(tag(wsfe?.body ?? '', 'Cuit')).toBe(CUIT);
  });

  it('cachea el token en la base hasta su vencimiento, también para un cliente nuevo; vencido, pide otro', async () => {
    const { fetchImpl, calls } = fakeArcaFetch(ALL_OK);
    const { arca, db, clock } = client(fetchImpl);
    await arca.lastAuthorizedNumber(3, 11);
    await arca.lastAuthorizedNumber(3, 11);
    expect(calls.filter((c) => c.url === WSAA_URL)).toHaveLength(1);
    expect(db.select().from(arcaTokens).all()).toEqual([
      expect.objectContaining({ service: 'wsfe', token: 'TOKEN-123', sign: 'SIGN-456' }),
    ]);

    // Otro cliente sobre la misma base (por ejemplo, tras un reinicio) reutiliza el token guardado.
    await client(fetchImpl, db, clock).arca.lastAuthorizedNumber(3, 11);
    expect(calls.filter((c) => c.url === WSAA_URL)).toHaveLength(1);

    clock.set('2026-10-16T06:00:00.000Z'); // pasó el vencimiento (02:00 de Argentina del 16)
    await arca.lastAuthorizedNumber(3, 11);
    expect(calls.filter((c) => c.url === WSAA_URL)).toHaveLength(2);
  });
});

describe('operaciones de WSFEv1 (RF-71, RF-76, RF-77, AC-70)', () => {
  it('FECompUltimoAutorizado: devuelve el último número autorizado del punto de venta para Factura C', async () => {
    const { fetchImpl, calls } = fakeArcaFetch(ALL_OK);
    expect(await client(fetchImpl).arca.lastAuthorizedNumber(3, 11)).toBe(41);
    const body = calls[1]?.body ?? '';
    expect(tag(body, 'PtoVta')).toBe('3');
    expect(tag(body, 'CbteTipo')).toBe('11');
  });

  it('AC-70: FECAESolicitar pide una Factura C de servicios con fechas de servicio, vencimiento y CondicionIVAReceptorId', async () => {
    const { fetchImpl, calls } = fakeArcaFetch(ALL_OK);
    const result = await client(fetchImpl).arca.requestCae(REQUEST);
    expect(result).toEqual({ cae: '76123456789012', caeDueDate: '2026-10-25' });

    const request = calls.find((c) => c.action.endsWith('FECAESolicitar'));
    const body = request?.body ?? '';
    expect(request?.url).toBe(WSFEV1_URL);
    expect(tag(body, 'CantReg')).toBe('1');
    expect(tag(body, 'PtoVta')).toBe('3');
    expect(tag(body, 'CbteTipo')).toBe('11');
    expect(tag(body, 'Concepto')).toBe('2');
    expect(tag(body, 'DocTipo')).toBe('80');
    expect(tag(body, 'DocNro')).toBe('30711111111');
    expect(tag(body, 'CbteDesde')).toBe('42');
    expect(tag(body, 'CbteHasta')).toBe('42');
    expect(tag(body, 'CbteFch')).toBe('20261015');
    expect(tag(body, 'ImpTotal')).toBe('201600.50');
    expect(tag(body, 'ImpNeto')).toBe('201600.50');
    expect(tag(body, 'ImpIVA')).toBe('0');
    expect(tag(body, 'FchServDesde')).toBe('20261001');
    expect(tag(body, 'FchServHasta')).toBe('20261031');
    expect(tag(body, 'FchVtoPago')).toBe('20261031');
    expect(tag(body, 'MonId')).toBe('PES');
    expect(tag(body, 'CondicionIVAReceptorId')).toBe('6');
  });

  it('RF-171: un rechazo por validación lanza ArcaRejectionError con el código y el mensaje de ARCA', async () => {
    const { fetchImpl } = fakeArcaFetch({ ...ALL_OK, FECAESolicitar: REJECTED });
    const failure = await client(fetchImpl).arca.requestCae(REQUEST).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ArcaRejectionError);
    expect((failure as Error).message).toContain('10015');
    expect((failure as Error).message).toContain('El campo DocNro no corresponde a un CUIT valido.');
  });

  it('RF-76: FECompConsultar devuelve el comprobante autorizado con su CAE, importe y CUIT receptor', async () => {
    const { fetchImpl, calls } = fakeArcaFetch(ALL_OK);
    expect(await client(fetchImpl).arca.findVoucher(3, 11, 7)).toEqual({
      cae: '76123456789012',
      caeDueDate: '2026-10-25',
      totalCents: 20_160_050,
      receiverCuit: '30711111111',
    });
    expect(tag(calls.at(-1)?.body ?? '', 'CbteNro')).toBe('7');
  });

  it('RF-76: si el comprobante no existe (código 602), FECompConsultar devuelve null', async () => {
    const { fetchImpl } = fakeArcaFetch({ ...ALL_OK, FECompConsultar: NOT_FOUND });
    expect(await client(fetchImpl).arca.findVoucher(3, 11, 7)).toBeNull();
  });

  it('una falla de comunicación (HTTP 500) no es un rechazo de validación', async () => {
    const { fetchImpl } = fakeArcaFetch({ loginCms: ALL_OK.loginCms });
    const failure = await client(fetchImpl).arca.requestCae(REQUEST).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ArcaRejectionError);
  });
});

describe('timeout de ARCA (RNF-07)', () => {
  it('AC-228: si WSFEv1 no responde, da la llamada por fallida a los 30 s y la cancela', async () => {
    vi.useFakeTimers();
    const db = createTestDb();
    // Token vigente guardado: la llamada que no responde es la de WSFEv1.
    db.insert(arcaTokens).values({ service: 'wsfe', token: 'T', sign: 'S', expiresAt: '2026-10-16T05:00:00.000Z' }).run();
    let signal: AbortSignal | undefined;
    const hanging = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          signal = init?.signal ?? undefined;
          signal?.addEventListener('abort', () => reject(signal?.reason));
        }),
    );

    let failure: unknown;
    const pending = client(hanging, db)
      .arca.lastAuthorizedNumber(3, 11)
      .catch((error: unknown) => {
        failure = error;
      });
    await vi.advanceTimersByTimeAsync(29_000);
    expect(failure).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(failure).toBeInstanceOf(TimeoutError);
    expect(signal?.aborted).toBe(true);
    expect(String(hanging.mock.calls[0]?.[0])).toBe(WSFEV1_URL);
  });
});

describe('estado del certificado (RF-97, RF-98)', () => {
  it('lee la fecha de vencimiento del certificado de ARCA_CERT_PATH', async () => {
    const { fetchImpl } = fakeArcaFetch(ALL_OK);
    expect(await client(fetchImpl).arca.certificateStatus()).toEqual({
      readable: true,
      notAfter: new Date('2028-01-01T00:00:00Z'),
    });
  });

  it('si el certificado no se puede leer, lo informa sin fecha', async () => {
    const { fetchImpl } = fakeArcaFetch(ALL_OK);
    const arca = createArcaHomologationClient({
      cuit: CUIT,
      certPath: join(dir, 'no-existe.crt'),
      keyPath,
      db: createTestDb(),
      clock: fixedClock(NOW),
      fetchImpl,
    });
    expect(await arca.certificateStatus()).toEqual({ readable: false, notAfter: null });
  });
});
