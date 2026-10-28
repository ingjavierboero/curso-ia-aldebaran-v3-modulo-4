import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { receivedAttachments, receivedEmails } from '../../src/db/schema.ts';
import { createTestApp, loggedInAgent, type TestApp } from '../helpers/test-app.ts';

const PDF = Buffer.from('%PDF-1.7 comprobante');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const HTML = Buffer.from('<html><script>fetch("/api/users")</script></html>');

function insertAttachment(t: TestApp, input: { filename: string; mimeType: string; content: Buffer }) {
  const email = t.db
    .insert(receivedEmails)
    .values({
      messageId: `<${Math.random()}@x>`,
      fromAddress: 'otro@desconocido.com',
      fromNormalized: 'otro@desconocido.com',
      subject: 'Pago',
      bodyText: '',
      receivedAt: '2026-10-20T13:00:00.000Z',
      processedAt: '2026-10-20T13:00:00.000Z',
    })
    .returning()
    .get();
  return t.db.insert(receivedAttachments).values({ receivedEmailId: email.id, ...input }).returning().get();
}

/** Headers que lleva toda respuesta que entrega un adjunto (RNF-16). */
function expectSafeHeaders(res: request.Response) {
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['content-security-policy']).toMatch(/(^|;\s*)sandbox(;|$)/);
  expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  expect(res.headers['cache-control']).toBe('private, no-store');
}

const download = (res: request.Response) => Buffer.from(res.body as Buffer);

describe('adjuntos servidos como contenido no confiable (RNF-16, research R-16)', () => {
  it('exige sesión', async () => {
    const t = createTestApp();
    const attachment = insertAttachment(t, { filename: 'comprobante.pdf', mimeType: 'application/pdf', content: PDF });
    expect((await request(t.app).get(`/api/attachments/${attachment.id}`)).status).toBe(401);
  });

  it('AC-255: un PDF verificado se entrega para mostrarse en el navegador, con los headers seguros', async () => {
    const t = createTestApp();
    const attachment = insertAttachment(t, { filename: 'comprobante.pdf', mimeType: 'application/pdf', content: PDF });
    const { agent } = await loggedInAgent(t, { role: 'consulta' });

    const res = await agent.get(`/api/attachments/${attachment.id}`).buffer(true).parse((r, done) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => done(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe('inline; filename="comprobante.pdf"');
    expectSafeHeaders(res);
    expect(download(res).equals(PDF)).toBe(true);
  });

  it('una imagen verificada también se muestra en el navegador', async () => {
    const t = createTestApp();
    const attachment = insertAttachment(t, { filename: 'captura.png', mimeType: 'image/png', content: PNG });
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const res = await agent.get(`/api/attachments/${attachment.id}`);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['content-disposition']).toMatch(/^inline;/);
    expectSafeHeaders(res);
  });

  it('AC-255: un adjunto cuyo contenido es HTML solo se entrega como descarga, con tipo genérico', async () => {
    const t = createTestApp();
    const attachment = insertAttachment(t, { filename: 'comprobante.html', mimeType: 'application/octet-stream', content: HTML });
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const res = await agent.get(`/api/attachments/${attachment.id}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toBe('attachment; filename="comprobante.html"');
    expectSafeHeaders(res);
  });

  it('el formato se vuelve a verificar al servirlo: un HTML guardado como PDF se entrega como descarga', async () => {
    const t = createTestApp();
    const attachment = insertAttachment(t, { filename: 'comprobante.pdf', mimeType: 'application/pdf', content: HTML });
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const res = await agent.get(`/api/attachments/${attachment.id}`);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
  });

  it('el nombre de archivo se sanea: sin rutas, comillas ni saltos de línea que inyecten headers', async () => {
    const t = createTestApp();
    const attachment = insertAttachment(t, {
      filename: '../../a"b\r\nX-Injected: 1.pdf',
      mimeType: 'application/pdf',
      content: PDF,
    });
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const res = await agent.get(`/api/attachments/${attachment.id}`);

    expect(res.status).toBe(200);
    expect(res.headers['x-injected']).toBeUndefined();
    const disposition = String(res.headers['content-disposition']);
    expect(disposition).not.toMatch(/[\r\n]/);
    expect(disposition).not.toContain('..');
    expect(disposition).not.toContain('/');
    const name = /filename="([^"]*)"/.exec(disposition)?.[1];
    expect(name).toBeDefined();
    expect(name).not.toContain('"');
    expect(name?.endsWith('.pdf')).toBe(true);
  });

  it('un adjunto inexistente responde 404', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    expect((await agent.get('/api/attachments/999')).status).toBe(404);
  });
});
