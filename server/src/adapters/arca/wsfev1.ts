import type { Db } from '../../db/client.ts';
import { type ArcaClient, ArcaRejectionError, type AuthorizedVoucher, type CaeRequest, type Clock } from '../types.ts';
import { readCertificateStatus } from './certificate.ts';
import { WSFEV1_URL } from './endpoints.ts';
import { ArcaCommunicationError, list, path, postSoap, text, type XmlNode } from './soap.ts';
import { createWsaa } from './wsaa.ts';

const WSFE_NS = 'http://ar.gov.afip.dif.FEV1/';
/** Concepto 2: servicios, con fechas de servicio y de vencimiento del pago (RF-80, RF-81). */
const CONCEPT_SERVICES = 2;
/** Tipo de documento 80: CUIT. */
const DOC_TYPE_CUIT = 80;
/** Código de FECompConsultar para un comprobante inexistente. */
const VOUCHER_NOT_FOUND = '602';

/** Centavos → importe de ARCA con punto decimal: 20160050 → "201600.50". */
export const toArcaAmount = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

/** Importe de ARCA → centavos: "201600.5" → 20160050. */
export function fromArcaAmount(amount: string): number {
  const [integer = '0', fraction = ''] = amount.trim().split('.');
  return Number(integer) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
}

/** `YYYY-MM-DD` ↔ `YYYYMMDD`. */
export const toArcaDate = (date: string) => date.replaceAll('-', '');
export const fromArcaDate = (date: string) => `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;

/** Junta los pares Code y Msg de un bloque de errores u observaciones: "[10015] El campo...". */
function messages(items: unknown): string[] {
  return list(items).map((item) => `[${text(path(item, 'Code'))}] ${text(path(item, 'Msg'))}`);
}

export interface ArcaHomologationOptions {
  /** CUIT del emisor (ARCA_CUIT). */
  cuit: string;
  certPath: string;
  keyPath: string;
  db: Db;
  clock: Clock;
  fetchImpl?: typeof fetch;
}

/**
 * Cliente de ARCA homologación (research R-06): WSAA para el ticket de acceso y WSFEv1 para Factura C.
 * Solo usa las URLs de homologación de endpoints.ts (Constitución V).
 */
export function createArcaHomologationClient(options: ArcaHomologationOptions): ArcaClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const wsaa = createWsaa({ ...options, fetchImpl });

  /** Llama a una operación de WSFEv1 con la autenticación y devuelve su nodo `<operación>Result`. */
  async function call(operation: string, body: string): Promise<XmlNode> {
    const { token, sign } = await wsaa.getTicket('wsfe');
    const envelope =
      `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${WSFE_NS}">` +
      `<soapenv:Header/><soapenv:Body><ar:${operation}>` +
      `<ar:Auth><ar:Token>${token}</ar:Token><ar:Sign>${sign}</ar:Sign><ar:Cuit>${options.cuit}</ar:Cuit></ar:Auth>` +
      `${body}</ar:${operation}></soapenv:Body></soapenv:Envelope>`;
    const response = await postSoap(WSFEV1_URL, `${WSFE_NS}${operation}`, envelope, fetchImpl);
    const result = path(response, 'Envelope', 'Body', `${operation}Response`, `${operation}Result`);
    if (!result || typeof result !== 'object') {
      throw new ArcaCommunicationError(`La respuesta de ARCA a ${operation} no tiene el formato esperado.`);
    }
    return result as XmlNode;
  }

  /** Errores generales de una operación (autenticación, parámetros): son fallas, no rechazos. */
  function throwOnErrors(result: XmlNode, operation: string): void {
    const errors = messages(path(result, 'Errors', 'Err'));
    if (errors.length > 0) throw new ArcaCommunicationError(`ARCA (${operation}): ${errors.join(' · ')}`);
  }

  return {
    async lastAuthorizedNumber(pointOfSale, voucherType) {
      const result = await call(
        'FECompUltimoAutorizado',
        `<ar:PtoVta>${pointOfSale}</ar:PtoVta><ar:CbteTipo>${voucherType}</ar:CbteTipo>`,
      );
      throwOnErrors(result, 'FECompUltimoAutorizado');
      const number = Number(text(path(result, 'CbteNro')));
      if (!Number.isInteger(number) || number < 0) {
        throw new ArcaCommunicationError('FECompUltimoAutorizado no devolvió un número de comprobante.');
      }
      return number;
    },

    async requestCae(req: CaeRequest) {
      const total = toArcaAmount(req.totalCents);
      // Factura C no discrimina IVA: el neto es el total y el IVA es 0 (RF-71).
      const detail =
        `<ar:Concepto>${CONCEPT_SERVICES}</ar:Concepto><ar:DocTipo>${DOC_TYPE_CUIT}</ar:DocTipo>` +
        `<ar:DocNro>${req.receiverCuit}</ar:DocNro>` +
        `<ar:CbteDesde>${req.number}</ar:CbteDesde><ar:CbteHasta>${req.number}</ar:CbteHasta>` +
        `<ar:CbteFch>${toArcaDate(req.issueDate)}</ar:CbteFch>` +
        `<ar:ImpTotal>${total}</ar:ImpTotal><ar:ImpTotConc>0</ar:ImpTotConc><ar:ImpNeto>${total}</ar:ImpNeto>` +
        '<ar:ImpOpEx>0</ar:ImpOpEx><ar:ImpTrib>0</ar:ImpTrib><ar:ImpIVA>0</ar:ImpIVA>' +
        `<ar:FchServDesde>${toArcaDate(req.serviceFrom)}</ar:FchServDesde>` +
        `<ar:FchServHasta>${toArcaDate(req.serviceTo)}</ar:FchServHasta>` +
        `<ar:FchVtoPago>${toArcaDate(req.dueDate)}</ar:FchVtoPago>` +
        '<ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz>' +
        `<ar:CondicionIVAReceptorId>${req.receiverIvaCondition}</ar:CondicionIVAReceptorId>`; // RF-77
      const result = await call(
        'FECAESolicitar',
        '<ar:FeCAEReq><ar:FeCabReq>' +
          `<ar:CantReg>1</ar:CantReg><ar:PtoVta>${req.pointOfSale}</ar:PtoVta>` +
          `<ar:CbteTipo>${req.voucherType}</ar:CbteTipo>` +
          `</ar:FeCabReq><ar:FeDetReq><ar:FECAEDetRequest>${detail}</ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq>`,
      );

      const detailResponse = list(path(result, 'FeDetResp', 'FECAEDetResponse'))[0];
      const outcome = text(path(detailResponse, 'Resultado'));
      const cae = text(path(detailResponse, 'CAE'));
      const caeDueDate = text(path(detailResponse, 'CAEFchVto'));
      if (outcome === 'A' && cae && caeDueDate) return { cae, caeDueDate: fromArcaDate(caeDueDate) };

      const reasons = [
        ...messages(path(result, 'Errors', 'Err')),
        ...messages(path(detailResponse, 'Observaciones', 'Obs')),
      ];
      const detailText = reasons.join(' · ') || 'sin detalle';
      // Sin resultado del comprobante, ARCA no lo evaluó (por ejemplo, un token inválido): es una falla.
      if (!outcome) throw new ArcaCommunicationError(`ARCA no procesó la factura: ${detailText}`);
      throw new ArcaRejectionError(`ARCA rechazó la factura ${req.pointOfSale}-${req.number}: ${detailText}`);
    },

    async findVoucher(pointOfSale, voucherType, number): Promise<AuthorizedVoucher | null> {
      const result = await call(
        'FECompConsultar',
        `<ar:FeCompConsReq><ar:CbteTipo>${voucherType}</ar:CbteTipo><ar:CbteNro>${number}</ar:CbteNro>` +
          `<ar:PtoVta>${pointOfSale}</ar:PtoVta></ar:FeCompConsReq>`,
      );
      const errors = list(path(result, 'Errors', 'Err'));
      if (errors.some((error) => text(path(error, 'Code')) === VOUCHER_NOT_FOUND)) return null;
      throwOnErrors(result, 'FECompConsultar');

      const voucher = path(result, 'ResultGet');
      if (!voucher) return null;
      return {
        cae: text(path(voucher, 'CodAutorizacion')),
        caeDueDate: fromArcaDate(text(path(voucher, 'FchVto'))),
        totalCents: fromArcaAmount(text(path(voucher, 'ImpTotal'))),
        receiverCuit: text(path(voucher, 'DocNro')),
      };
    },

    async certificateStatus() {
      return readCertificateStatus(options.certPath);
    },
  };
}
