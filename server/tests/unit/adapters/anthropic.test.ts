import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttachmentInput } from '../../../src/adapters/types.ts';
import { HttpStatusError } from '../../helpers/fakes.ts';

// El SDK de Anthropic se reemplaza: ningún test llama a Claude (AGENTS.md).
const sdk = vi.hoisted(() => ({
  create: vi.fn(),
  constructed: [] as unknown[],
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: sdk.create };
    constructor(options: unknown) {
      sdk.constructed.push(options);
    }
  },
}));

const { createAnthropicClassifier, CLASSIFIER_MODEL } = await import('../../../src/adapters/llm/anthropic.ts');

const PDF = new TextEncoder().encode('%PDF-1.7 comprobante');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const input = (overrides: Partial<AttachmentInput> = {}): AttachmentInput => ({
  emailBody: 'Adjunto el comprobante de la transferencia de octubre.',
  filename: 'comprobante.pdf',
  mimeType: 'application/pdf',
  content: PDF,
  ...overrides,
});

/** Respuesta de Claude con la herramienta de clasificación. */
const toolResponse = (toolInput: unknown) => ({
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id: 'toolu_1', name: 'clasificar_adjunto', input: toolInput }],
});

type CreateParams = {
  model: string;
  system: string;
  messages: Array<{ role: string; content: Array<Record<string, unknown>> }>;
  tools: Array<{ name: string; input_schema: { properties: Record<string, { enum?: string[] }> } }>;
  tool_choice: { type: string; name?: string };
};
const lastParams = () => sdk.create.mock.calls.at(-1)?.[0] as CreateParams;

beforeEach(() => {
  sdk.create.mockReset();
  sdk.constructed.length = 0;
});
afterEach(() => vi.useRealTimers());

describe('clasificador de adjuntos con Claude (RF-119 a RF-122, research R-07)', () => {
  it('AC-226: usa ANTHROPIC_API_KEY y el modelo de AGENTS.md, sin los reintentos del SDK y con 10 s por llamada', async () => {
    sdk.create.mockResolvedValue(toolResponse({ clasificacion: 'no', cuit_ordenante: null, monto: null }));
    await createAnthropicClassifier('clave-de-prueba').classify(input());

    expect(sdk.constructed).toEqual([expect.objectContaining({ apiKey: 'clave-de-prueba', maxRetries: 0, timeout: 10_000 })]);
    expect(CLASSIFIER_MODEL).toBe('claude-haiku-4-5-20251001');
    expect(lastParams().model).toBe('claude-haiku-4-5-20251001');
  });

  it('RF-119: envía el cuerpo del email y el PDF como bloque document en base64', async () => {
    sdk.create.mockResolvedValue(toolResponse({ clasificacion: 'no', cuit_ordenante: null, monto: null }));
    await createAnthropicClassifier('k').classify(input());

    const content = lastParams().messages[0]?.content ?? [];
    expect(content).toContainEqual({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(PDF).toString('base64') },
    });
    expect(JSON.stringify(content)).toContain('Adjunto el comprobante de la transferencia de octubre.');
  });

  it('RF-119: una imagen va como bloque image con su tipo', async () => {
    sdk.create.mockResolvedValue(toolResponse({ clasificacion: 'no', cuit_ordenante: null, monto: null }));
    await createAnthropicClassifier('k').classify(input({ filename: 'captura.png', mimeType: 'image/png', content: PNG }));

    expect(lastParams().messages[0]?.content).toContainEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: Buffer.from(PNG).toString('base64') },
    });
  });

  it('pide la respuesta con una herramienta forzada que solo admite "si", "no" o "dudoso"', async () => {
    sdk.create.mockResolvedValue(toolResponse({ clasificacion: 'no', cuit_ordenante: null, monto: null }));
    await createAnthropicClassifier('k').classify(input());

    const params = lastParams();
    expect(params.tool_choice).toEqual({ type: 'tool', name: params.tools[0]?.name });
    expect(params.tools[0]?.input_schema.properties.clasificacion?.enum).toEqual(['si', 'no', 'dudoso']);
  });

  it('RF-119, RF-121, AC-244: el prompt pide el CUIT del ordenante y clasificar como "dudoso" un pago en otra moneda', async () => {
    sdk.create.mockResolvedValue(toolResponse({ clasificacion: 'no', cuit_ordenante: null, monto: null }));
    await createAnthropicClassifier('k').classify(input());

    const system = lastParams().system;
    expect(system).toMatch(/ordenante/i);
    expect(system).toMatch(/beneficiario/i);
    expect(system).toMatch(/otra moneda|moneda distinta/i);
    expect(system).toMatch(/dudoso/);
  });

  it('RF-120: un comprobante devuelve "si" con el CUIT normalizado y el monto como texto', async () => {
    sdk.create.mockResolvedValue(toolResponse({ clasificacion: 'si', cuit_ordenante: '30-71111111-1', monto: '15000.50' }));
    expect(await createAnthropicClassifier('k').classify(input())).toEqual({
      kind: 'si',
      cuit: '30711111111',
      amountRaw: '15000.50',
    });
  });

  it('AC-114, RF-122: un CUIT de menos de 11 dígitos se descarta como no extraído', async () => {
    sdk.create.mockResolvedValue(toolResponse({ clasificacion: 'si', cuit_ordenante: '30-7111111', monto: '100' }));
    expect(await createAnthropicClassifier('k').classify(input())).toEqual({ kind: 'si', cuit: null, amountRaw: '100' });
  });

  it('"no" y "dudoso" se devuelven sin CUIT ni monto', async () => {
    sdk.create.mockResolvedValueOnce(toolResponse({ clasificacion: 'no', cuit_ordenante: '30711111111', monto: '1' }));
    sdk.create.mockResolvedValueOnce(toolResponse({ clasificacion: 'dudoso', cuit_ordenante: null, monto: null }));
    const classifier = createAnthropicClassifier('k');
    expect(await classifier.classify(input())).toEqual({ kind: 'no' });
    expect(await classifier.classify(input())).toEqual({ kind: 'dudoso' });
  });

  it('cada llamada recibe la señal de corte de su intento (RNF-02)', async () => {
    sdk.create.mockResolvedValue(toolResponse({ clasificacion: 'no', cuit_ordenante: null, monto: null }));
    await createAnthropicClassifier('k').classify(input());
    expect(sdk.create.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
});

describe('fallas del LLM (RNF-02)', () => {
  it('AC-117: un HTTP 401 hace una sola llamada y el procesamiento es erróneo', async () => {
    sdk.create.mockRejectedValue(new HttpStatusError(401));
    const result = await createAnthropicClassifier('k').classify(input());
    expect(sdk.create).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ kind: 'error' });
  });

  it('RNF-02 (c): una clasificación inválida o una respuesta sin la herramienta se reintentan; tras el cuarto intento, error', async () => {
    vi.useFakeTimers();
    sdk.create
      .mockResolvedValueOnce(toolResponse({ clasificacion: 'quizás', cuit_ordenante: null, monto: null }))
      .mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Parece un comprobante.' }] })
      .mockResolvedValueOnce(toolResponse({ cuit_ordenante: null }))
      .mockResolvedValueOnce(toolResponse({ clasificacion: 'maybe', cuit_ordenante: null, monto: null }));

    const pending = createAnthropicClassifier('k').classify(input());
    await vi.advanceTimersByTimeAsync(14_000);
    expect(await pending).toMatchObject({ kind: 'error' });
    expect(sdk.create).toHaveBeenCalledTimes(4);
  });

  it('una respuesta inválida seguida de una válida usa la válida', async () => {
    vi.useFakeTimers();
    sdk.create
      .mockResolvedValueOnce(toolResponse({ clasificacion: 'quizás', cuit_ordenante: null, monto: null }))
      .mockResolvedValueOnce(toolResponse({ clasificacion: 'dudoso', cuit_ordenante: null, monto: null }));
    const pending = createAnthropicClassifier('k').classify(input());
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await pending).toEqual({ kind: 'dudoso' });
  });
});

describe('varios adjuntos de un mismo email (RNF-01)', () => {
  it('los adjuntos se pueden clasificar en paralelo: la segunda llamada no espera a la primera', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    sdk.create.mockImplementation(async () => {
      await gate;
      return toolResponse({ clasificacion: 'no', cuit_ordenante: null, monto: null });
    });
    const classifier = createAnthropicClassifier('k');

    const both = Promise.all([classifier.classify(input()), classifier.classify(input({ filename: 'otro.pdf' }))]);
    await vi.waitFor(() => expect(sdk.create).toHaveBeenCalledTimes(2));
    release();
    expect(await both).toEqual([{ kind: 'no' }, { kind: 'no' }]);
  });
});
