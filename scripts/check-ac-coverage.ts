// Lista los criterios de aceptación del PRD que no aparecen en ningún test (research R-15, SC-010).
// Uso: npm run test:coverage-ac. Termina con código 1 si falta algún AC.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// El PRD los declara fuera de la suite automática: evaluación del LLM real y rendimiento.
const EXTERNAL = new Set([109, 110, 111, 232, 233, 234]);

function testFiles(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true, recursive: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && /\.test\.tsx?$/.test(e.name))
    .map((e) => join(e.parentPath, e.name));
}

/** IDs de AC citados en un texto, incluidos los rangos "AC-133 a AC-142". */
function citedIds(text: string): Set<number> {
  const ids = new Set<number>();
  for (const match of text.matchAll(/AC-(\d+)(?: a AC-(\d+))?/g)) {
    const from = Number(match[1]);
    const to = match[2] ? Number(match[2]) : from;
    for (let id = from; id <= to; id++) ids.add(id);
  }
  return ids;
}

const prd = readFileSync(join(root, 'PRD.md'), 'utf8');
const required = [...prd.matchAll(/^- AC-(\d+) /gm)].map((m) => Number(m[1])).filter((id) => !EXTERNAL.has(id));

const files = [...testFiles(join(root, 'server/tests')), ...testFiles(join(root, 'web/tests'))];
const covered = new Set<number>();
for (const file of files) for (const id of citedIds(readFileSync(file, 'utf8'))) covered.add(id);

const missing = required.filter((id) => !covered.has(id)).sort((a, b) => a - b);

console.log(`Tests revisados: ${files.length}. AC de la suite automática: ${required.length}.`);
if (missing.length === 0) {
  console.log('Todos los AC tienen al menos un test que los cita.');
} else {
  console.log(`AC sin test (${missing.length}): ${missing.map((id) => `AC-${String(id).padStart(2, '0')}`).join(', ')}`);
  process.exitCode = 1;
}
