/**
 * Lógica del script de evaluación del LLM real (RNF-14, AC-109 a AC-111): carga del set y cálculo de
 * aciertos. Usa un clasificador fake: este test nunca llama a Claude (AGENTS.md).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AttachmentInput, ClassificationResult } from '../../../src/adapters/types.ts';
import {
  evaluate,
  loadSamples,
  MIN_PER_CLASS,
  summarize,
  type Sample,
} from '../../../scripts/eval/llm-evaluation.ts';

const PDF = new TextEncoder().encode('%PDF-1.4 comprobante');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aldebaran-eval-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function file(kind: string, name: string, content: Uint8Array | string) {
  mkdirSync(join(dir, kind), { recursive: true });
  writeFileSync(join(dir, kind, name), content);
}

const sample = (expected: Sample['expected'], name = `${expected}.pdf`, extra: Partial<Sample> = {}): Sample => ({
  path: `${expected}/${name}`,
  expected,
  mimeType: 'application/pdf',
  content: PDF,
  emailBody: '',
  ...extra,
});

/** Clasificador fake que responde según el nombre del archivo de la ruta, sin mirar el nombre que recibe. */
function fakeClassifier(answers: Record<string, ClassificationResult>) {
  const calls: AttachmentInput[] = [];
  let index = 0;
  const order = Object.values(answers);
  return {
    calls,
    async classify(input: AttachmentInput) {
      calls.push(input);
      return order[index++] ?? { kind: 'no' };
    },
  };
}

describe('carga del set de evaluación', () => {
  it('toma la clase de la carpeta, el tipo real de la firma y el cuerpo y los datos esperados del .json opcional', () => {
    file('si', 'transferencia.pdf', PDF);
    const info = { cuerpo: 'Adjunto el pago', cuit: '30711111111', monto: '15000.50' };
    file('si', 'transferencia.pdf.json', JSON.stringify(info));
    file('no', 'foto.png', PNG);
    file('dudoso', 'borroso.pdf', PDF);

    const samples = loadSamples(dir);

    expect(samples).toEqual([
      expect.objectContaining({ path: 'dudoso/borroso.pdf', expected: 'dudoso', mimeType: 'application/pdf' }),
      expect.objectContaining({ path: 'no/foto.png', expected: 'no', mimeType: 'image/png', emailBody: '' }),
      expect.objectContaining({
        path: 'si/transferencia.pdf',
        expected: 'si',
        emailBody: 'Adjunto el pago',
        expectedCuit: '30711111111',
        expectedAmountCents: 1_500_050,
      }),
    ]);
  });

  it('descarta los archivos que no son PDF ni imagen por su firma, aunque digan serlo, y avisa cuáles', () => {
    file('si', 'falso.pdf', '<html>no es un pdf</html>');
    file('si', 'bueno.pdf', PDF);
    const skipped: string[] = [];

    const samples = loadSamples(dir, (path) => skipped.push(path));

    expect(samples.map((s) => s.path)).toEqual(['si/bueno.pdf']);
    expect(skipped).toEqual(['si/falso.pdf']);
  });

  it('sin la carpeta del set, falla con un mensaje que explica dónde ponerlo', () => {
    expect(() => loadSamples(join(dir, 'no-existe'))).toThrow(/fixtures/);
  });
});

describe('evaluación y reporte (RNF-14)', () => {
  it('envía cada adjunto con un nombre neutro, para que el nombre del archivo no delate su clase', async () => {
    const classifier = fakeClassifier({ a: { kind: 'si', cuit: null, amountRaw: null } });
    await evaluate(classifier, [sample('si', 'comprobante_si_1.pdf')]);
    expect(classifier.calls[0]?.filename).toBe('adjunto.pdf');
  });

  it('calcula los aciertos por clase y aprueba con al menos el 95 % y ningún "si" clasificado como "no"', async () => {
    const samples = [
      ...Array.from({ length: 20 }, (_, i) => sample('si', `si-${i}.pdf`)),
      ...Array.from({ length: 20 }, (_, i) => sample('no', `no-${i}.pdf`)),
      ...Array.from({ length: 20 }, (_, i) => sample('dudoso', `dudoso-${i}.pdf`)),
    ];
    const answers: ClassificationResult[] = [
      ...Array.from({ length: 19 }, () => ({ kind: 'si' as const, cuit: null, amountRaw: null })),
      { kind: 'dudoso' }, // un "si" como "dudoso": 95 %, sigue aprobando
      ...Array.from({ length: 20 }, () => ({ kind: 'no' as const })),
      ...Array.from({ length: 20 }, () => ({ kind: 'dudoso' as const })),
    ];
    const classifier = fakeClassifier(Object.fromEntries(answers.map((a, i) => [i, a])));

    const report = summarize(await evaluate(classifier, samples));

    expect(report.classes.si).toMatchObject({ total: 20, hits: 19, rate: 0.95, passed: true });
    expect(report.classes.no).toMatchObject({ total: 20, hits: 20, rate: 1, passed: true });
    expect(report.siClassifiedAsNo).toEqual([]);
    expect(report.misses).toEqual([{ path: 'si/si-19.pdf', expected: 'si', got: 'dudoso' }]);
    expect(report.passed).toBe(true);
  });

  it('un solo comprobante legible clasificado como "no" reprueba, aunque la clase supere el 95 %', async () => {
    const samples = Array.from({ length: 20 }, (_, i) => sample('si', `si-${i}.pdf`));
    const answers = [
      ...Array.from({ length: 19 }, () => ({ kind: 'si' as const, cuit: null, amountRaw: null })),
      { kind: 'no' as const },
    ];
    const classifier = fakeClassifier(Object.fromEntries(answers.map((a, i) => [i, a])));
    const report = summarize(await evaluate(classifier, samples));

    expect(report.classes.si.passed).toBe(true);
    expect(report.siClassifiedAsNo).toEqual(['si/si-19.pdf']);
    expect(report.passed).toBe(false);
  });

  it(`con menos de ${MIN_PER_CLASS} adjuntos en alguna clase, el set está incompleto y no aprueba`, async () => {
    const report = summarize(await evaluate(fakeClassifier({}), [sample('no')]));
    expect(report.complete).toBe(false);
    expect(report.passed).toBe(false);
  });

  it('compara el CUIT y el monto extraídos con los esperados cuando el .json los indica', async () => {
    const samples = [
      sample('si', 'a.pdf', { expectedCuit: '30711111111', expectedAmountCents: 1_500_050 }),
      sample('si', 'b.pdf', { expectedCuit: '30711111111', expectedAmountCents: 1_000_000 }),
    ];
    const classifier = fakeClassifier({
      a: { kind: 'si', cuit: '30711111111', amountRaw: '15000.50' },
      b: { kind: 'si', cuit: '20111111112', amountRaw: '10000' },
    });

    const report = summarize(await evaluate(classifier, samples));

    expect(report.extraction).toEqual({ checked: 2, cuitHits: 1, amountHits: 2 });
  });

  it('un error del LLM cuenta como fallo de la clase y queda en el reporte', async () => {
    const report = summarize(
      await evaluate(fakeClassifier({ a: { kind: 'error', message: 'timeout' } }), [sample('dudoso')]),
    );
    expect(report.misses).toEqual([{ path: 'dudoso/dudoso.pdf', expected: 'dudoso', got: 'error: timeout' }]);
  });
});
