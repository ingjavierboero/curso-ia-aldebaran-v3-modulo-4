import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { clientEvents, invoices, sentEmails, settings } from '../../../src/db/schema.ts';
import { runBilling } from '../../../src/services/billing.ts';
import { sendInvoiceEmail } from '../../../src/services/invoice-email.ts';
import { createTestApp, type TestApp } from '../../helpers/test-app.ts';
import { assignProduct, configureIssuer, insertClient, insertInvoice, insertProduct } from '../../helpers/test-db.ts';

/** 15/10/2026 a las 11:00 de Argentina. */
const OCT_15 = '2026-10-15T14:00:00.000Z';

function billingApp(issuer: Partial<typeof settings.$inferInsert> = {}) {
  const t = createTestApp({ now: OCT_15 });
  configureIssuer(t.db, { issuerTradeName: null, ...issuer });
  return t;
}

/** Cliente facturable con una cuota de octubre de $201.600. */
function octoberClient(t: TestApp) {
  const client = insertClient(t.db, { ivaCondition: 6, billingEmail: 'pagos@losandes.com' });
  assignProduct(t.db, client.id, insertProduct(t.db, { priceCents: 20_160_000 }).id);
  return client;
}

const run = (t: TestApp) => runBilling(t.ctx, { period: '2026-10', triggeredBy: 'agente_dia_15' });
const onlyEmail = (t: TestApp) => {
  expect(t.adapters.mailSender.sent).toHaveLength(1);
  return t.adapters.mailSender.sent[0]!;
};
/** Texto del email con espacios normales (Intl usa un espacio duro después de "$"). */
const textOf = (email: { text: string }) => email.text.replace(/\s/g, ' ');

describe('email de la factura (RF-84, RF-85)', () => {
  it('AC-78: se envía al email de facturación con el PDF adjunto, informando la deuda pendiente', async () => {
    const t = billingApp();
    octoberClient(t);
    await run(t);

    const email = onlyEmail(t);
    expect(email.to).toBe('pagos@losandes.com');
    expect(email.subject).toContain('0003-00000001');
    expect(email.attachments).toEqual([
      expect.objectContaining({ filename: expect.stringMatching(/\.pdf$/), mimeType: 'application/pdf' }),
    ]);
    expect(Buffer.from(email.attachments?.[0]?.content ?? []).subarray(0, 5).toString()).toBe('%PDF-');
    expect(textOf(email)).toMatch(/deuda pendiente/i);
  });

  it('RF-85: el email sale dentro del minuto siguiente a la generación, en la misma corrida', async () => {
    const t = billingApp();
    const client = octoberClient(t);
    await run(t);

    const invoice = t.db.select().from(invoices).where(eq(invoices.clientId, client.id)).get();
    const sent = t.db.select().from(sentEmails).where(eq(sentEmails.invoiceId, invoice?.id ?? -1)).get();
    expect(sent).toMatchObject({ kind: 'factura', trigger: 'automatico', clientId: client.id, toAddress: 'pagos@losandes.com' });
    expect(new Date(sent?.sentAt ?? 0).getTime() - new Date(invoice?.createdAt ?? 0).getTime()).toBeLessThan(60_000);
  });

  it('AC-78: el envío queda en el historial del cliente con la fecha, la hora y el destinatario', async () => {
    const t = billingApp();
    const client = octoberClient(t);
    await run(t);

    const events = t.db.select().from(clientEvents).where(eq(clientEvents.clientId, client.id)).all();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'email_enviado',
        actorType: 'agente',
        occurredAt: OCT_15,
        payload: expect.objectContaining({ kind: 'factura', to: 'pagos@losandes.com' }),
      }),
    );
  });
});

describe('contenido del email (RF-88 a RF-90)', () => {
  it('AC-81: informa número, período, importe y vencimiento, la deuda vigente con las facturas anteriores y pide el comprobante', async () => {
    const t = billingApp();
    const client = octoberClient(t);
    insertInvoice(t.db, { clientId: client.id, period: '2026-09', status: 'revision_manual', totalCents: 1_500_000 });
    await run(t);

    const text = textOf(onlyEmail(t));
    expect(text).toContain('0003-00000001');
    expect(text).toMatch(/octubre (de )?2026/i);
    expect(text).toContain('$ 201.600,00');
    expect(text).toContain('31/10/2026');
    expect(text).toContain('$ 216.600,00');
    expect(text).toMatch(/facturas anteriores/i);
    expect(text).toMatch(/adjunt\w* el comprobante de pago/i);
  });

  it('RF-88: sin facturas anteriores adeudadas, la deuda es la de la factura y no menciona facturas anteriores', async () => {
    const t = billingApp();
    octoberClient(t);
    await run(t);

    const text = textOf(onlyEmail(t));
    expect(text.match(/\$ 201\.600,00/g)?.length).toBeGreaterThanOrEqual(1);
    expect(text).not.toMatch(/facturas anteriores/i);
  });

  it('RF-88 aclarado: la deuda vigente se calcula en cada envío; la factura no cambia', async () => {
    const t = billingApp();
    const client = octoberClient(t);
    const september = insertInvoice(t.db, { clientId: client.id, period: '2026-09', status: 'pendiente_de_pago', totalCents: 1_500_000 });
    await run(t);
    const october = t.db.select().from(invoices).where(eq(invoices.period, '2026-10')).get();
    expect(textOf(onlyEmail(t))).toContain('$ 216.600,00');

    // Entre un envío y el siguiente, el cliente pagó septiembre.
    t.db.update(invoices).set({ status: 'pagada' }).where(eq(invoices.id, september.id)).run();
    await sendInvoiceEmail(t.ctx, october?.id ?? -1, 'reintento_manual');

    const resent = textOf(t.adapters.mailSender.sent[1]!);
    expect(resent).not.toContain('$ 216.600,00');
    expect(resent).not.toMatch(/facturas anteriores/i);
    expect(t.db.select().from(invoices).where(eq(invoices.id, october?.id ?? -1)).get()).toEqual(october);
  });

  it('AC-82: el cuerpo del email indica que el comprobante se emitió en homologación y no tiene validez fiscal', async () => {
    const t = billingApp();
    octoberClient(t);
    await run(t);

    const text = textOf(onlyEmail(t));
    expect(text).toMatch(/homologación/i);
    expect(text).toMatch(/no tiene validez fiscal/i);
  });
});

describe('remitente y firma (RF-215)', () => {
  it('AC-237: con nombre de fantasía, el remitente y la firma son "Estudio Molina"', async () => {
    const t = billingApp({ issuerBusinessName: 'Molina Hernando Agustina Maria', issuerTradeName: 'Estudio Molina' });
    octoberClient(t);
    await run(t);

    const email = onlyEmail(t);
    expect(email.fromName).toBe('Estudio Molina');
    expect(email.text.trim().endsWith('Estudio Molina')).toBe(true);
  });

  it('AC-237: sin nombre de fantasía, el remitente y la firma son la razón social', async () => {
    const t = billingApp({ issuerBusinessName: 'Molina Hernando Agustina Maria', issuerTradeName: null });
    octoberClient(t);
    await run(t);

    const email = onlyEmail(t);
    expect(email.fromName).toBe('Molina Hernando Agustina Maria');
    expect(email.text.trim().endsWith('Molina Hernando Agustina Maria')).toBe(true);
  });
});
