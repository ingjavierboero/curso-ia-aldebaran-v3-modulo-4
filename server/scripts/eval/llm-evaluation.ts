/**
 * Evaluación de la clasificación del LLM sobre un set de adjuntos etiquetados (RNF-14, AC-109 a AC-111).
 * La usa `llm-classification.ts` con el clasificador real; está separada para poder probarla con un fake.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { AttachmentClassifier } from '../../src/adapters/types.ts';
import { detectFileType } from '../../src/domain/file-signature.ts';
import { parseExtractedAmount } from '../../src/domain/money.ts';

/** RNF-14: al menos 20 adjuntos por clase y el 95 % de aciertos en cada una. */
export const MIN_PER_CLASS = 20;
export const MIN_RATE = 0.95;

export const CLASSES = ['si', 'no', 'dudoso'] as const;
export type ExpectedClass = (typeof CLASSES)[number];

export interface Sample {
  /** Ruta relativa al set, por ejemplo `si/transferencia-1.pdf`. */
  path: string;
  expected: ExpectedClass;
  mimeType: string;
  content: Uint8Array;
  emailBody: string;
  expectedCuit?: string;
  expectedAmountCents?: number;
}

/** Datos opcionales de un adjunto, en `<archivo>.json` junto a él. */
interface SampleInfo {
  cuerpo?: string;
  cuit?: string;
  monto?: string;
}

/**
 * Lee el set: una carpeta por clase (`si/`, `no/`, `dudoso/`) con los adjuntos. El tipo se toma de la
 * firma del archivo, como en el procesamiento real (RF-117); lo que no es PDF ni imagen se descarta.
 */
export function loadSamples(dir: string, onSkip: (path: string) => void = () => {}): Sample[] {
  if (!existsSync(dir)) {
    throw new Error(`No existe el set de evaluación en ${dir}: ver scripts/eval/fixtures/README.md.`);
  }
  const samples: Sample[] = [];
  for (const expected of CLASSES) {
    const classDir = join(dir, expected);
    if (!existsSync(classDir)) continue;
    for (const name of readdirSync(classDir).sort()) {
      if (name.endsWith('.json') || name.startsWith('.')) continue;
      const path = `${expected}/${name}`;
      const content = new Uint8Array(readFileSync(join(classDir, name)));
      const mimeType = detectFileType(content);
      if (!mimeType) {
        onSkip(path);
        continue;
      }
      const infoPath = join(classDir, `${name}.json`);
      const info: SampleInfo = existsSync(infoPath) ? JSON.parse(readFileSync(infoPath, 'utf8')) : {};
      const amount = parseExtractedAmount(info.monto);
      samples.push({
        path,
        expected,
        mimeType,
        content,
        emailBody: info.cuerpo ?? '',
        ...(info.cuit ? { expectedCuit: info.cuit } : {}),
        ...(amount.status === 'ok' ? { expectedAmountCents: amount.cents } : {}),
      });
    }
  }
  return samples.sort((a, b) => a.path.localeCompare(b.path));
}

export interface SampleResult {
  sample: Sample;
  got: string;
  cuit: string | null;
  amountCents: number | null;
}

/**
 * Clasifica cada adjunto de a uno. Se envía con un nombre neutro (`adjunto.pdf`): el nombre del archivo
 * del set suele delatar su clase y sesgaría la medición.
 */
export async function evaluate(
  classifier: AttachmentClassifier,
  samples: Sample[],
  onProgress: (done: number, total: number) => void = () => {},
): Promise<SampleResult[]> {
  const results: SampleResult[] = [];
  for (const sample of samples) {
    const result = await classifier.classify({
      emailBody: sample.emailBody,
      filename: `adjunto${extname(sample.path)}`,
      mimeType: sample.mimeType,
      content: sample.content,
    });
    const amount = result.kind === 'si' ? parseExtractedAmount(result.amountRaw) : null;
    results.push({
      sample,
      got: result.kind === 'error' ? `error: ${result.message}` : result.kind,
      cuit: result.kind === 'si' ? result.cuit : null,
      amountCents: amount?.status === 'ok' ? amount.cents : null,
    });
    onProgress(results.length, samples.length);
  }
  return results;
}

export interface EvaluationReport {
  classes: Record<ExpectedClass, { total: number; hits: number; rate: number; passed: boolean }>;
  /** RNF-14: ningún comprobante legible puede clasificarse como "no". */
  siClassifiedAsNo: string[];
  misses: Array<{ path: string; expected: ExpectedClass; got: string }>;
  /** CUIT y monto extraídos, en los comprobantes que tienen los valores esperados en su `.json`. */
  extraction: { checked: number; cuitHits: number; amountHits: number };
  /** Hay al menos MIN_PER_CLASS adjuntos en cada clase. */
  complete: boolean;
  passed: boolean;
}

export function summarize(results: SampleResult[]): EvaluationReport {
  const classes = Object.fromEntries(
    CLASSES.map((expected) => {
      const ofClass = results.filter((r) => r.sample.expected === expected);
      const hits = ofClass.filter((r) => r.got === expected).length;
      const rate = ofClass.length ? hits / ofClass.length : 0;
      return [expected, { total: ofClass.length, hits, rate, passed: ofClass.length > 0 && rate >= MIN_RATE }];
    }),
  ) as EvaluationReport['classes'];

  const withExpected = results.filter(
    (r) => r.sample.expected === 'si' && (r.sample.expectedCuit || r.sample.expectedAmountCents),
  );
  const complete = CLASSES.every((c) => classes[c].total >= MIN_PER_CLASS);
  const siClassifiedAsNo = results
    .filter((r) => r.sample.expected === 'si' && r.got === 'no')
    .map((r) => r.sample.path);

  return {
    classes,
    siClassifiedAsNo,
    misses: results
      .filter((r) => r.got !== r.sample.expected)
      .map((r) => ({ path: r.sample.path, expected: r.sample.expected, got: r.got })),
    extraction: {
      checked: withExpected.length,
      cuitHits: withExpected.filter((r) => r.sample.expectedCuit && r.cuit === r.sample.expectedCuit).length,
      amountHits: withExpected.filter(
        (r) => r.sample.expectedAmountCents && r.amountCents === r.sample.expectedAmountCents,
      ).length,
    },
    complete,
    passed: complete && CLASSES.every((c) => classes[c].passed) && siClassifiedAsNo.length === 0,
  };
}
