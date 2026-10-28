/**
 * Evaluación del LLM real (RNF-14, AC-109 a AC-111): clasifica el set de `scripts/eval/fixtures/` con
 * el mismo adapter que usa el sistema (Claude, el modelo de AGENTS.md) y reporta los aciertos por clase.
 *
 * Uso: npm run eval:llm -w server [-- <carpeta del set>]
 * Necesita ANTHROPIC_API_KEY (en .env). Cada adjunto es una llamada paga a la API: no es parte de la suite
 * de tests. Termina con código 0 si cumple RNF-14, 1 si no y 2 si no se pudo correr.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLASSIFIER_MODEL, createAnthropicClassifier } from '../../src/adapters/llm/anthropic.ts';
import { CLASSES, evaluate, loadSamples, MIN_PER_CLASS, MIN_RATE, summarize } from './llm-evaluation.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = process.argv[2] ?? join(here, 'fixtures');
const percent = (rate: number) => `${(rate * 100).toFixed(1)} %`;

async function main(): Promise<number> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    console.error('Falta ANTHROPIC_API_KEY: la evaluación usa el LLM real.');
    return 2;
  }

  const samples = loadSamples(dir, (path) => console.warn(`Se descarta ${path}: no es un PDF ni una imagen.`));
  console.log(`Set: ${dir}`);
  console.log(`Modelo: ${CLASSIFIER_MODEL}. Adjuntos: ${samples.length} (una llamada a la API por cada uno).`);

  const results = await evaluate(createAnthropicClassifier(apiKey), samples, (done, total) => {
    process.stdout.write(`\rClasificando ${done}/${total}…`);
  });
  process.stdout.write('\n\n');
  const report = summarize(results);

  for (const kind of CLASSES) {
    const c = report.classes[kind];
    const mark = c.passed && c.total >= MIN_PER_CLASS ? 'OK ' : 'NO ';
    console.log(`${mark} "${kind}": ${c.hits}/${c.total} (${percent(c.rate)}; mínimo ${percent(MIN_RATE)})`);
  }
  if (!report.complete) {
    console.log(`\nEl set está incompleto: hacen falta al menos ${MIN_PER_CLASS} adjuntos por clase.`);
  }
  if (report.siClassifiedAsNo.length) {
    const files = report.siClassifiedAsNo.join(', ');
    console.log(`\nComprobantes clasificados como "no" (RNF-14 no admite ninguno): ${files}`);
  }
  if (report.extraction.checked) {
    const { checked, cuitHits, amountHits } = report.extraction;
    console.log(
      `\nExtracción en ${checked} comprobantes con datos esperados: ` +
        `CUIT ${cuitHits}/${checked}, monto ${amountHits}/${checked}.`,
    );
  }
  if (report.misses.length) {
    console.log('\nErrores de clasificación:');
    for (const miss of report.misses) {
      console.log(`  ${miss.path}: esperado "${miss.expected}", obtenido "${miss.got}"`);
    }
  }

  const reportsDir = join(here, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const file = join(reportsDir, `llm-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ model: CLASSIFIER_MODEL, dir, ...report }, null, 2));
  console.log(`\nReporte: ${file}`);
  console.log(report.passed ? 'Resultado: cumple RNF-14.' : 'Resultado: NO cumple RNF-14.');
  return report.passed ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  },
);
