/**
 * Rendimiento con el volumen de referencia (AC-232 a AC-234): facturación de 50 clientes, recordatorios
 * a 50 clientes y p95 por email sobre 100 emails. Corre sobre una base en memoria: nunca toca las bases
 * de `data/`.
 *
 * Uso: npm run eval:perf -w server -- <facturacion|recordatorios|emails|todos> [opciones]
 *   --mock                 ARCA, el LLM y el email simulados (sin costo, para probar el script)
 *   --confirmar            obligatorio fuera de mock: usa ARCA homologación, Gmail y Claude de verdad
 *   --punto-de-venta N     punto de venta de homologación para la facturación (por defecto 1)
 *   --emails N             cantidad de emails del escenario de emails (por defecto 100)
 *   --set CARPETA          adjuntos para el escenario de emails (por defecto scripts/eval/fixtures/si)
 *
 * Fuera de mock exige EMAIL_REDIRECT_TO, así ningún email sale a los clientes de prueba. Termina con
 * código 0 si todo cumple, 1 si algo no cumple y 2 si no se pudo correr.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createAdapters } from '../../src/adapters/index.ts';
import type { EmailAttachment } from '../../src/adapters/types.ts';
import { loadEnv } from '../../src/config/env.ts';
import type { AppContext } from '../../src/context.ts';
import { openDatabase } from '../../src/db/client.ts';
import { detectFileType } from '../../src/domain/file-signature.ts';
import {
  runBillingScenario,
  runEmailsScenario,
  runRemindersScenario,
  type ScenarioResult,
} from './performance-scenarios.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const SCENARIOS = ['facturacion', 'recordatorios', 'emails'] as const;
type Scenario = (typeof SCENARIOS)[number];

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    mock: { type: 'boolean', default: false },
    confirmar: { type: 'boolean', default: false },
    'punto-de-venta': { type: 'string', default: '1' },
    emails: { type: 'string', default: '100' },
    set: { type: 'string', default: join(here, 'fixtures', 'si') },
  },
});

/** Contexto nuevo por escenario, sobre una base en memoria, con los adapters del modo elegido. */
function context(): AppContext {
  const env = values.mock ? loadEnv({ MOCK_MODE: 'true' }) : loadEnv();
  const db = openDatabase(':memory:');
  return { db, env, adapters: createAdapters(env, db) };
}

/** Adjuntos para el escenario de emails: en mock, comprobantes con el nombre que entiende el mock (RF-189). */
function attachments(): (index: number) => EmailAttachment {
  if (values.mock) {
    const content = new TextEncoder().encode('%PDF-1.4 comprobante simulado');
    return (i) => ({ filename: `pago_x_15000.50-${i}.pdf`, mimeType: 'application/pdf', content });
  }
  const files: EmailAttachment[] = [];
  for (const name of readdirSync(values.set)) {
    if (name.endsWith('.json') || name.startsWith('.')) continue;
    const content = new Uint8Array(readFileSync(join(values.set, name)));
    const mimeType = detectFileType(content);
    // Como en el procesamiento real, el tipo sale de la firma; lo que no es PDF ni imagen se descarta.
    if (mimeType) files.push({ filename: `comprobante${extname(name)}`, mimeType, content });
  }
  if (files.length === 0) throw new Error(`No hay comprobantes PDF ni imágenes en ${values.set}.`);
  return (i) => files[i % files.length]!;
}

async function run(scenario: Scenario): Promise<ScenarioResult> {
  const ctx = context();
  if (scenario === 'facturacion') {
    return runBillingScenario(ctx, { clients: 50, pointOfSale: Number(values['punto-de-venta']) });
  }
  if (scenario === 'recordatorios') return runRemindersScenario(ctx, { clients: 50 });
  return runEmailsScenario(ctx, { emails: Number(values.emails), attachment: attachments() });
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

async function main(): Promise<number> {
  const requested = positionals[0] ?? 'todos';
  const scenarios = requested === 'todos' ? [...SCENARIOS] : SCENARIOS.filter((s) => s === requested);
  if (scenarios.length === 0) {
    console.error(`Escenario desconocido: ${requested}. Opciones: ${SCENARIOS.join(', ')} o todos.`);
    return 2;
  }
  if (!values.mock) {
    const env = loadEnv();
    if (!env.emailRedirectTo) {
      console.error('Fuera de mock hace falta EMAIL_REDIRECT_TO: los emails de prueba no pueden salir a clientes.');
      return 2;
    }
    if (!values.confirmar) {
      console.error(
        'Fuera de mock el script usa ARCA homologación, Gmail y Claude de verdad (con costo). ' +
          'Agregá --confirmar para correrlo, o usá --mock.',
      );
      return 2;
    }
  }

  console.log(`Modo: ${values.mock ? 'mock' : 'homologación'}. Base en memoria: no se toca data/.\n`);
  let allPassed = true;
  for (const scenario of scenarios) {
    process.stdout.write(`${scenario}… `);
    const result = await run(scenario);
    allPassed &&= result.passed;
    const time = result.p95Ms === undefined ? `duración ${seconds(result.durationMs)}` : `p95 ${seconds(result.p95Ms)}`;
    const mark = result.passed ? 'OK' : 'NO';
    console.log(`${mark}: ${result.ok}/${result.items} completados, ${time} (límite ${seconds(result.limitMs)})`);
  }
  console.log(allPassed ? '\nResultado: cumple RNF-01, RNF-03 y RNF-04.' : '\nResultado: NO cumple.');
  return allPassed ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  },
);
