import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { MOCK_MAILBOX_ADDRESS, createMockMail } from '../../src/adapters/mail/mock-mailbox.ts';
import {
  invoices,
  notices,
  receivedAttachments,
  receivedEmails,
  simulatedAttachments,
  simulatedEmails,
} from '../../src/db/schema.ts';
import { ATTACHMENT_CSP } from '../../src/http/attachment-response.ts';
import { runBilling } from '../../src/services/billing.ts';
import { checkMailbox } from '../../src/services/mailbox-check.ts';
import { agent, createMockTestApp, createTestApp, loggedInAgent } from '../helpers/test-app.ts';
import {
  assignProduct,
  configureIssuer,
  insertClient,
  insertInvoice,
  insertProduct,
  insertUser,
} from '../helpers/test-db.ts';

/** 20/10/2026 a las 10:00 de Argentina. */
const NOW = '2026-10-20T13:00:00.000Z';

const PDF = Buffer.from('%PDF-1.4 comprobante de pago');
const HTML = Buffer.from('<html><script>alert(document.cookie)</script></html>');
const base64 = (content: Buffer) => content.toString('base64');

/** Email recibido como lo envía la web al cargarlo en la casilla simulada (contracts/http-api.md). */
const receivedEmail = (overrides: Record<string, unknown> = {}) => ({
  from: 'pagos@losandes.com',
  subject: 'Pago de octubre',
  body: 'Adjunto el comprobante.',
  attachments: [{ filename: 'pago_30711111111_15000.50.pdf', mimeType: 'application/pdf', contentBase64: base64(PDF) }],
  ...overrides,
});

/** Sistema en modo mock con un cliente de CUIT 30711111111 y email de facturación pagos@losandes.com. */
function mockSystem() {
  const t = createMockTestApp({ now: NOW });
  const client = insertClient(t.db, { cuit: '30711111111', billingEmail: 'pagos@losandes.com', ivaCondition: 6 });
  return { t, client };
}

const simulated = (t: { db: ReturnType<typeof createMockTestApp>['db'] }) => t.db.select().from(simulatedEmails).all();

describe('casilla simulada: ver emails (RF-197, RF-198)', () => {
  it('AC-200: un Admin ve el email de una factura entre los enviados, con remitente, destinatario, asunto, cuerpo, PDF y fecha', async () => {
    const { t, client } = mockSystem();
    configureIssuer(t.db);
    assignProduct(t.db, client.id, insertProduct(t.db).id);
    await runBilling(t.ctx, { period: '2026-10', triggeredBy: 'agente_dia_15' });
    const { agent: admin } = await loggedInAgent(t, { role: 'admin' });

    const res = await admin.get('/api/mock-mailbox');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        id: expect.any(Number),
        direction: 'enviado',
        from: MOCK_MAILBOX_ADDRESS,
        to: 'pagos@losandes.com',
        subject: expect.stringContaining('0003-00000001'),
        body: expect.stringContaining('Factura C'),
        createdAt: NOW,
        attachments: [
          expect.objectContaining({
            id: expect.any(Number),
            filename: expect.stringMatching(/\.pdf$/),
            mimeType: 'application/pdf',
          }),
        ],
      }),
    ]);
    const [email] = res.body as Array<{ id: number; attachments: Array<{ id: number }> }>;
    const pdf = await admin.get(`/api/mock-mailbox/${email!.id}/attachments/${email!.attachments[0]!.id}`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(Buffer.from(pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('AC-221: un Editor o Consulta ve solo los recibidos desde el email de un cliente; un Admin ve todos', async () => {
    const { t } = mockSystem();
    const mail = createMockMail(t.db, t.adapters.clock);
    await mail.sender.send({ fromName: 'Estudio', to: 'pagos@losandes.com', subject: 'Factura', text: 'Factura' });
    mail.addReceived({ from: 'Pagos@LosAndes.com', subject: 'Pago', body: 'Comprobante', attachments: [] });
    mail.addReceived({ from: 'otro@desconocido.com', subject: 'Consulta', body: 'Hola', attachments: [] });

    for (const role of ['editor', 'consulta'] as const) {
      const { agent: user } = await loggedInAgent(t, { role });
      const res = await user.get('/api/mock-mailbox');
      expect(res.status).toBe(200);
      expect(res.body.map((email: { subject: string }) => email.subject)).toEqual(['Pago']);
    }

    const { agent: admin } = await loggedInAgent(t, { role: 'admin' });
    const res = await admin.get('/api/mock-mailbox');
    expect(res.body.map((email: { subject: string }) => email.subject).sort()).toEqual(['Consulta', 'Factura', 'Pago']);
  });

  it('un Editor no puede abrir el adjunto de un email que no ve', async () => {
    const { t } = mockSystem();
    const mail = createMockMail(t.db, t.adapters.clock);
    await mail.sender.send({
      fromName: 'Estudio',
      to: 'pagos@losandes.com',
      subject: 'Factura',
      text: 'Factura',
      attachments: [{ filename: 'factura.pdf', mimeType: 'application/pdf', content: new Uint8Array(PDF) }],
    });
    const [email] = simulated(t);
    const [attachment] = t.db.select().from(simulatedAttachments).all();
    const { agent: editor } = await loggedInAgent(t, { role: 'editor' });

    const res = await editor.get(`/api/mock-mailbox/${email!.id}/attachments/${attachment!.id}`);
    expect(res.status).toBe(404);
  });

  it('un adjunto que no pertenece a ese email da 404', async () => {
    const { t } = mockSystem();
    const { agent: admin } = await loggedInAgent(t, { role: 'admin' });
    await admin.post('/api/mock-mailbox/received').send(receivedEmail());
    const other = await admin.post('/api/mock-mailbox/received').send(receivedEmail({ subject: 'Otro' }));
    const [attachment] = t.db.select().from(simulatedAttachments).all();

    const res = await admin.get(`/api/mock-mailbox/${other.body.id}/attachments/${attachment!.id}`);
    expect(res.status).toBe(404);
  });
});

describe('casilla simulada: cargar un email recibido (RF-200 a RF-202)', () => {
  it.each(['admin', 'editor'] as const)(
    'AC-203: un %s carga un email con Message-ID único y la fecha de carga como recepción',
    async (role) => {
      const { t } = mockSystem();
      const { agent: user, user: me } = await loggedInAgent(t, { role });

      const res = await user.post('/api/mock-mailbox/received').send(receivedEmail());

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: expect.any(Number),
        direction: 'recibido',
        messageId: expect.stringMatching(/^<.+>$/),
        from: 'pagos@losandes.com',
        to: MOCK_MAILBOX_ADDRESS,
        subject: 'Pago de octubre',
        body: 'Adjunto el comprobante.',
        createdAt: NOW,
        attachments: [
          expect.objectContaining({ filename: 'pago_30711111111_15000.50.pdf', mimeType: 'application/pdf' }),
        ],
      });
      const [saved] = simulated(t);
      expect(saved).toMatchObject({ direction: 'recibido', loadedByUserId: me.id });
      const [attachment] = t.db.select().from(simulatedAttachments).all();
      expect(Buffer.from(attachment!.content).equals(PDF)).toBe(true);
    },
  );

  it('AC-219: un usuario Consulta no puede cargar un email y no se crea ninguno', async () => {
    const { t } = mockSystem();
    const { agent: consulta } = await loggedInAgent(t, { role: 'consulta' });

    const res = await consulta.post('/api/mock-mailbox/received').send(receivedEmail());

    expect(res.status).toBe(403);
    expect(simulated(t)).toHaveLength(0);
  });

  it('sin sesión no se puede ver ni cargar la casilla simulada', async () => {
    const { t } = mockSystem();
    expect((await agent(t).get('/api/mock-mailbox')).status).toBe(401);
    expect((await agent(t).post('/api/mock-mailbox/received').send(receivedEmail())).status).toBe(401);
    expect(simulated(t)).toHaveLength(0);
  });

  it.each([
    ['sin remitente', { from: '' }],
    ['con un remitente que no es un email', { from: 'no-es-un-email' }],
    [
      'con un adjunto sin nombre',
      { attachments: [{ filename: '', mimeType: 'application/pdf', contentBase64: base64(PDF) }] },
    ],
  ])('rechaza con 400 un email %s y no lo crea', async (_case, overrides) => {
    const { t } = mockSystem();
    const { agent: admin } = await loggedInAgent(t, { role: 'admin' });

    const res = await admin.post('/api/mock-mailbox/received').send(receivedEmail(overrides));

    expect(res.status).toBe(400);
    expect(simulated(t)).toHaveLength(0);
  });

  it('AC-201: un email cargado con el remitente de la casilla del sistema se ignora en la siguiente revisión', async () => {
    const { t, client } = mockSystem();
    const invoice = insertInvoice(t.db, { clientId: client.id, period: '2026-10', number: 1, totalCents: 1_500_050 });
    const { agent: admin } = await loggedInAgent(t, { role: 'admin' });
    await admin.post('/api/mock-mailbox/received').send(receivedEmail({ from: MOCK_MAILBOX_ADDRESS }));

    await checkMailbox(t.ctx);

    expect(t.db.select().from(receivedEmails).all()).toHaveLength(0);
    expect(t.db.select().from(receivedAttachments).all()).toHaveLength(0);
    expect(t.db.select().from(notices).all()).toHaveLength(0);
    expect(t.db.select().from(invoices).where(eq(invoices.id, invoice.id)).get()?.status).toBe('pendiente_de_pago');
  });
});

describe('casilla simulada: adjuntos como contenido no confiable (RNF-16)', () => {
  it('AC-255: un adjunto HTML que dice ser PDF se guarda como application/octet-stream y solo se descarga', async () => {
    const { t } = mockSystem();
    const { agent: admin } = await loggedInAgent(t, { role: 'admin' });
    const created = await admin.post('/api/mock-mailbox/received').send(
      receivedEmail({
        attachments: [{ filename: 'comprobante.pdf', mimeType: 'application/pdf', contentBase64: base64(HTML) }],
      }),
    );
    expect(created.status).toBe(201);
    expect(created.body.attachments[0].mimeType).toBe('application/octet-stream');
    const [attachment] = t.db.select().from(simulatedAttachments).all();
    expect(attachment?.mimeType).toBe('application/octet-stream');

    const res = await admin.get(`/api/mock-mailbox/${created.body.id}/attachments/${attachment!.id}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe(ATTACHMENT_CSP);
  });

  it('AC-255: un PDF verificado se guarda con su tipo y se muestra en el navegador', async () => {
    const { t } = mockSystem();
    const { agent: consulta } = await loggedInAgent(t, { role: 'consulta' });
    const { agent: editor } = await loggedInAgent(t, { role: 'editor' });
    const created = await editor.post('/api/mock-mailbox/received').send(
      receivedEmail({
        attachments: [{ filename: 'pago.pdf', mimeType: 'application/octet-stream', contentBase64: base64(PDF) }],
      }),
    );
    expect(created.body.attachments[0].mimeType).toBe('application/pdf');

    const url = `/api/mock-mailbox/${created.body.id}/attachments/${created.body.attachments[0].id}`;
    const res = await consulta.get(url);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/^inline;/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe(ATTACHMENT_CSP);
  });
});

describe('recuperación de contraseña en modo mock (RF-199)', () => {
  it('AC-202: una solicitud directa de recuperación se rechaza y no se guarda ningún email en la casilla simulada', async () => {
    const { t } = mockSystem();
    const user = insertUser(t.db, { role: 'editor' });

    const res = await agent(t).post('/api/auth/recovery').send({ email: user.email });

    expect(res.status).toBe(403);
    expect(simulated(t)).toHaveLength(0);
  });
});

describe('casilla simulada fuera del modo mock (RF-204)', () => {
  it('AC-220: un Admin no puede abrir la casilla simulada, cargar un email ni abrir un adjunto', async () => {
    const t = createTestApp({ now: NOW });
    const { agent: admin } = await loggedInAgent(t, { role: 'admin' });

    expect((await admin.get('/api/mock-mailbox')).status).toBe(403);
    expect((await admin.post('/api/mock-mailbox/received').send(receivedEmail())).status).toBe(403);
    expect((await admin.get('/api/mock-mailbox/1/attachments/1')).status).toBe(403);
    expect(simulated(t)).toHaveLength(0);
  });
});
