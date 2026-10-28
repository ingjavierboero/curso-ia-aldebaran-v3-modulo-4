/**
 * Marcas del modo mock (RF-206, RF-208, RF-210): el PDF y los emails de cada factura dicen que son
 * simulados, sin perder la leyenda de homologación, y el CUIT emisor es el de prueba o ARCA_CUIT. Usa los
 * adapters reales del modo mock; solo la cotización es un fake, para no salir a internet (AGENTS.md).
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAdapters } from '../../../src/adapters/index.ts';
import { createApp } from '../../../src/app.ts';
import { loadEnv } from '../../../src/config/env.ts';
import type { AppContext } from '../../../src/context.ts';
import { simulatedAttachments, simulatedEmails } from '../../../src/db/schema.ts';
import { HOMOLOGATION_NOTICE } from '../../../src/documents/invoice-pdf.ts';
import { runBilling } from '../../../src/services/billing.ts';
import { FakeFx, fixedClock } from '../../helpers/fakes.ts';
import { pdfText } from '../../helpers/pdf-text.ts';
import { createTestApp, loggedInAgent, type TestApp } from '../../helpers/test-app.ts';
import { assignProduct, configureIssuer, createTestDb, insertClient, insertProduct } from '../../helpers/test-db.ts';

/** 15/10/2026 a las 11:00 de Argentina. */
const OCT_15 = '2026-10-15T14:00:00.000Z';

/** Leyenda del modo mock: dice que el documento se generó en modo mock y es simulado (RF-210). */
const MOCK_NOTICE = /generad[oa] en modo mock.*simulad[oa]/i;

/** Texto con los espacios normalizados, para buscar frases que pdfkit o Intl parten o separan distinto. */
const flat = (text: string) => text.replace(/\s+/g, ' ');

/** Sistema en modo mock (MOCK_MODE y, opcionalmente, ARCA_CUIT) con un cliente facturable. */
function mockSystem(raw: Record<string, string> = {}) {
  const env = loadEnv({ MOCK_MODE: 'true', ...raw });
  const db = createTestDb();
  const adapters = { ...createAdapters(env, db, fixedClock(OCT_15)), fx: new FakeFx() };
  const ctx: AppContext = { db, env, adapters };
  configureIssuer(db);
  const client = insertClient(db, { ivaCondition: 6, billingEmail: 'pagos@losandes.com' });
  assignProduct(db, client.id, insertProduct(db).id);
  return { env, db, ctx, app: createApp(ctx, { log: () => {} }) };
}

/** Factura octubre y devuelve el email de la factura que quedó en la casilla simulada, con el texto del PDF. */
async function billAndReadEmail(system: ReturnType<typeof mockSystem>) {
  await runBilling(system.ctx, { period: '2026-10', triggeredBy: 'agente_dia_15' });
  const [email] = system.db.select().from(simulatedEmails).where(eq(simulatedEmails.direction, 'enviado')).all();
  expect(email).toBeDefined();
  const [attachment] = system.db
    .select()
    .from(simulatedAttachments)
    .where(eq(simulatedAttachments.simulatedEmailId, email!.id))
    .all();
  expect(attachment?.filename).toMatch(/\.pdf$/);
  return { body: flat(email!.body), pdf: flat(pdfText(new Uint8Array(attachment!.content))) };
}

describe('marcas del modo mock (RF-206, RF-208, RF-210)', () => {
  it('AC-207: el PDF de la factura indica que se generó en modo mock y es simulado, y conserva la leyenda de homologación', async () => {
    const { pdf } = await billAndReadEmail(mockSystem());
    expect(pdf).toMatch(MOCK_NOTICE);
    expect(pdf).toContain(HOMOLOGATION_NOTICE);
  });

  it('AC-207: el email de la factura indica que se generó en modo mock y es simulado, y conserva la leyenda de homologación', async () => {
    const { body } = await billAndReadEmail(mockSystem());
    expect(body).toMatch(MOCK_NOTICE);
    expect(body).toContain(HOMOLOGATION_NOTICE);
  });

  it('RF-210: fuera del modo mock, ni el PDF ni el email de la factura llevan la leyenda del modo mock', async () => {
    const t: TestApp = createTestApp({ now: OCT_15 });
    configureIssuer(t.db);
    assignProduct(t.db, insertClient(t.db, { ivaCondition: 6 }).id, insertProduct(t.db).id);
    await runBilling(t.ctx, { period: '2026-10', triggeredBy: 'agente_dia_15' });

    const [email] = t.adapters.mailSender.sent;
    expect(flat(email?.text ?? '')).not.toMatch(/modo mock/i);
    expect(flat(email?.text ?? '')).toContain(HOMOLOGATION_NOTICE);
    expect(flat(pdfText(email?.attachments?.[0]?.content ?? new Uint8Array()))).not.toMatch(/modo mock/i);
  });

  it('AC-205: sin ARCA_CUIT, el PDF muestra 20111111112 como CUIT del emisor', async () => {
    const { pdf } = await billAndReadEmail(mockSystem());
    expect(pdf).toContain('CUIT: 20-11111111-2');
  });

  it('AC-205: con ARCA_CUIT definida, el PDF muestra ese CUIT como emisor', async () => {
    const { pdf } = await billAndReadEmail(mockSystem({ ARCA_CUIT: '30711111111' }));
    expect(pdf).toContain('CUIT: 30-71111111-1');
    expect(pdf).not.toContain('20-11111111-2');
  });

  it('AC-206: sin ningún certificado de ARCA configurado, el dashboard no muestra el banner de certificado', async () => {
    const system = mockSystem();
    expect(system.env).toMatchObject({ arcaCertPath: null, arcaKeyPath: null });
    const { agent } = await loggedInAgent(system as unknown as TestApp, { role: 'consulta' });

    const res = await agent.get('/api/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.banners.certificate).toBeNull();
  });
});
