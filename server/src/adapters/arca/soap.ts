import { XMLParser } from 'fast-xml-parser';
import { TimeoutError } from '../types.ts';

/** RNF-07: ARCA (WSAA y WSFEv1) se da por caído si no responde en 30 s. */
export const ARCA_TIMEOUT_MS = 30_000;

/** Falla de comunicación con ARCA (conexión, HTTP, SOAP Fault o respuesta inesperada): se puede reintentar. */
export class ArcaCommunicationError extends Error {}

// Sin prefijos de namespace y con los valores como texto: un CAE de 14 dígitos no debe pasar a número.
const parser = new XMLParser({ removeNSPrefix: true, parseTagValue: false, trimValues: true });

export type XmlNode = Record<string, unknown>;

export function parseXml(xml: string): XmlNode {
  return parser.parse(xml) as XmlNode;
}

/** Hijo de un nodo, o undefined si no existe. */
export function child(node: unknown, name: string): unknown {
  return node && typeof node === 'object' ? (node as XmlNode)[name] : undefined;
}

/** Recorre un camino de nodos. */
export function path(node: unknown, ...names: string[]): unknown {
  return names.reduce<unknown>((current, name) => child(current, name), node);
}

/** Un elemento que puede aparecer una o varias veces, siempre como lista. */
export function list(node: unknown): unknown[] {
  if (node === undefined || node === null || node === '') return [];
  return Array.isArray(node) ? node : [node];
}

export function text(node: unknown): string {
  return typeof node === 'string' ? node : node === undefined || node === null ? '' : String(node);
}

export function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * POST de un sobre SOAP 1.1 con el timeout de 30 s: si ARCA no responde, cancela el pedido y lanza
 * TimeoutError. Devuelve el sobre de la respuesta ya parseado.
 */
export async function postSoap(
  url: string,
  action: string,
  envelope: string,
  fetchImpl: typeof fetch,
): Promise<XmlNode> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new TimeoutError('ARCA no respondió en 30 s.')), ARCA_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: action },
      body: envelope,
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) {
      // Los SOAP Fault llegan con HTTP 500.
      const fault = body ? text(path(parseXml(body), 'Envelope', 'Body', 'Fault', 'faultstring')) : '';
      throw new ArcaCommunicationError(`ARCA respondió con un error: ${fault || `HTTP ${response.status}`}`);
    }
    return parseXml(body);
  } catch (error) {
    if (error instanceof TimeoutError || error instanceof ArcaCommunicationError) throw error;
    throw new ArcaCommunicationError(
      `No se pudo conectar con ARCA: ${error instanceof Error ? error.message : 'error desconocido'}`,
    );
  } finally {
    clearTimeout(timer);
  }
}
