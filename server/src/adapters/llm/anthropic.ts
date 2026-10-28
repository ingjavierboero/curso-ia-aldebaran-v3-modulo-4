import Anthropic from '@anthropic-ai/sdk';
import { parseExtractedCuit } from '../../domain/cuit.ts';
import type { AttachmentClassifier, AttachmentInput, ClassificationResult } from '../types.ts';
import { InvalidLlmResponseError, LLM_TIMEOUT_MS, LlmFailedError, runWithRetries } from './retry-policy.ts';

/** Modelo que fija AGENTS.md para clasificar los adjuntos. */
export const CLASSIFIER_MODEL = 'claude-haiku-4-5-20251001';

const TOOL_NAME = 'clasificar_adjunto';

/** Herramienta con el esquema de la respuesta (research R-07). */
const CLASSIFICATION_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    'Registra la clasificación del adjunto y, si es un comprobante de pago, el CUIT del ordenante y el monto.',
  input_schema: {
    type: 'object',
    properties: {
      clasificacion: {
        type: 'string',
        enum: ['si', 'no', 'dudoso'],
        description: '"si" si es un comprobante de pago, "no" si no lo es, "dudoso" si no se puede determinar.',
      },
      cuit_ordenante: {
        type: ['string', 'null'],
        description: 'CUIT de quien realizó el pago (ordenante u originante), tal como figura; null si no aparece.',
      },
      monto: {
        type: ['string', 'null'],
        description:
          'Monto pagado con punto decimal y sin separadores de miles (por ejemplo, 15000.50); null si no aparece.',
      },
    },
    required: ['clasificacion', 'cuit_ordenante', 'monto'],
    additionalProperties: false,
  },
};

/** Instrucciones de RF-119 a RF-121. */
export const SYSTEM_PROMPT = [
  'Clasificás archivos que los clientes adjuntan al responder el email de una factura.',
  'Respondé siempre con la herramienta clasificar_adjunto, usando también el cuerpo del email como contexto.',
  '- "si": el archivo es un comprobante de un pago en pesos argentinos (transferencia, depósito, pago).',
  '- "no": el archivo no es un comprobante de pago (por ejemplo, una factura, una foto o un documento cualquiera).',
  '- "dudoso": no se puede determinar si es un pago, el archivo es ilegible, o es un pago en otra moneda',
  '  distinta del peso (por ejemplo, en dólares).',
  'Si es "si", indicá el CUIT del ordenante u originante, es decir, de quien realizó el pago; nunca el del',
  'beneficiario que recibió el dinero. Indicá también el monto pagado.',
].join('\n');

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

/** El adjunto como bloque `document` (PDF) o `image`, en base64. */
function fileBlock(input: AttachmentInput): Anthropic.ContentBlockParam {
  const data = Buffer.from(input.content).toString('base64');
  if (input.mimeType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  }
  if ((IMAGE_TYPES as readonly string[]).includes(input.mimeType)) {
    return { type: 'image', source: { type: 'base64', media_type: input.mimeType as ImageType, data } };
  }
  throw new LlmFailedError(`El formato ${input.mimeType} no se puede enviar al LLM.`);
}

/** Lee la respuesta de la herramienta; si no se puede interpretar, lanza un error que se reintenta. */
function parseResponse(message: Anthropic.Message): ClassificationResult {
  const tool = message.content.find((block) => block.type === 'tool_use' && block.name === TOOL_NAME);
  if (!tool || tool.type !== 'tool_use') throw new InvalidLlmResponseError('El LLM no respondió con la herramienta.');
  const input = tool.input as { clasificacion?: unknown; cuit_ordenante?: unknown; monto?: unknown };
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

  switch (input.clasificacion) {
    case 'si':
      // RF-122: un CUIT que no tiene 11 dígitos cuenta como no extraído.
      return { kind: 'si', cuit: parseExtractedCuit(text(input.cuit_ordenante)), amountRaw: text(input.monto) };
    case 'no':
      return { kind: 'no' };
    case 'dudoso':
      return { kind: 'dudoso' };
    default:
      throw new InvalidLlmResponseError(`Clasificación inválida: ${JSON.stringify(input.clasificacion)}.`);
  }
}

/**
 * Clasificador de adjuntos con Claude (RF-119 a RF-122, research R-07): un pedido por adjunto, con el
 * cuerpo del email como contexto. Los reintentos y el timeout los maneja la política de RNF-02, no el
 * SDK; si fallan todos los intentos, el procesamiento del adjunto es erróneo. Los adjuntos de un mismo
 * email se pueden clasificar en paralelo.
 */
export function createAnthropicClassifier(apiKey: string): AttachmentClassifier {
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: LLM_TIMEOUT_MS });

  return {
    async classify(input) {
      try {
        const content: Anthropic.ContentBlockParam[] = [
          fileBlock(input),
          { type: 'text', text: `Cuerpo del email:\n${input.emailBody}\n\nNombre del archivo: ${input.filename}` },
        ];
        return await runWithRetries(async (signal) => {
          const message = await client.messages.create(
            {
              model: CLASSIFIER_MODEL,
              max_tokens: 1024,
              system: SYSTEM_PROMPT,
              tools: [CLASSIFICATION_TOOL],
              tool_choice: { type: 'tool', name: TOOL_NAME },
              messages: [{ role: 'user', content }],
            },
            { signal },
          );
          return parseResponse(message);
        });
      } catch (error) {
        return { kind: 'error', message: error instanceof Error ? error.message : 'error desconocido' };
      }
    },
  };
}
