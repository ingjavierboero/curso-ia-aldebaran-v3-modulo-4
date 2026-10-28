import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { invoices, processErrors, products, retryQueue, sentEmails } from '../../src/db/schema.ts';
import { recordProcessError } from '../../src/services/process-errors.ts';
import { timeout } from '../helpers/fakes.ts';
import { createTestApp, loggedInAgent, type TestApp } from '../helpers/test-app.ts';
import { assignProduct, configureIssuer, insertClient, insertInvoice, insertProduct } from '../helpers/test-db.ts';

/** 15/10/2026 a las 15:00 de Argentina. */
const NOW = '2026-10-15T18:00:00.000Z';
const at = new Date(NOW);

/** Cliente facturable (Los Andes) sin la factura de octubre, con su error de generación Pendiente. */
function generationError() {
  const t = createTestApp({ now: NOW });
  configureIssuer(t.db);
  const client = insertClient(t.db, {
    businessName: 'Los Andes SRL',
    billingEmail: 'pagos@losandes.com',
    ivaCondition: 6,
  });
  const product = insertProduct(t.db);
  assignProduct(t.db, client.id, product.id);
  const error = recordProcessError(t.db, {
    operation: 'generacion_factura',
    clientId: client.id,
    period: '2026-10',
    attempts: 4,
    message: 'WSFEv1 no respondió a tiempo',
    now: at,
  });
  return { t, client, product, error };
}

/** Factura de octubre ya generada (con CAE) cuyo email falló: error de envío Pendiente. */
function sendError() {
  const t = createTestApp({ now: NOW });
  configureIssuer(t.db);
  const client = insertClient(t.db, { businessName: 'Los Andes SRL', billingEmail: 'pagos@losandes.com' });
  const invoice = insertInvoice(t.db, {
    clientId: client.id,
    period: '2026-10',
    number: 1,
    cae: '71234567890123',
    caeDueDate: '2026-10-25',
  });
  const error = recordProcessError(t.db, {
    operation: 'envio_factura',
    clientId: client.id,
    period: '2026-10',
    invoiceId: invoice.id,
    attempts: 4,
    message: 'Gmail rechazó el envío',
    now: at,
  });
  return { t, client, invoice, error };
}

const errorRow = (t: TestApp, id: number) =>
  t.db.select().from(processErrors).where(eq(processErrors.id, id)).get();
const invoiceEmails = (t: TestApp) => t.db.select().from(sentEmails).where(eq(sentEmails.kind, 'factura')).all();

describe('errores de proceso en la interfaz de revisión (RF-175)', () => {
  it('AC-186: lista los Pendientes con cliente, operación, período, intentos y último mensaje, sin los Resueltos', async () => {
    const { t, client, error } = generationError();
    const solved = recordProcessError(t.db, {
      operation: 'envio_factura',
      clientId: client.id,
      period: '2026-09',
      attempts: 4,
      message: 'viejo',
      now: at,
    });
    t.db.update(processErrors).set({ status: 'resuelto' }).where(eq(processErrors.id, solved.id)).run();
    const { agent } = await loggedInAgent(t, { role: 'consulta' });

    const res = await agent.get('/api/review/errors');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: error.id,
        operation: 'generacion_factura',
        clientId: client.id,
        clientName: 'Los Andes SRL',
        period: '2026-10',
        invoiceId: null,
        voucherNumber: null,
        attempts: 4,
        lastErrorMessage: 'WSFEv1 no respondió a tiempo',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);
  });
});

describe('reintento manual (RF-176 a RF-179)', () => {
  it('AC-187, AC-188: reintentar una generación genera la factura, la envía por email y pasa el error a Resuelto', async () => {
    const { t, client, error } = generationError();
    const { agent, user } = await loggedInAgent(t, { role: 'editor' });

    const res = await agent.post(`/api/review/errors/${error.id}/retry`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'resuelto' });
    expect(t.adapters.arca.requests).toHaveLength(1);
    const invoice = t.db.select().from(invoices).where(eq(invoices.clientId, client.id)).get();
    expect(invoice?.status).toBe('pendiente_de_pago');
    expect(t.adapters.mailSender.sent.map((email) => email.to)).toEqual(['pagos@losandes.com']);
    expect(invoiceEmails(t)).toEqual([
      expect.objectContaining({ invoiceId: invoice?.id, trigger: 'reintento_manual', sentByUserId: user.id }),
    ]);
    expect(errorRow(t, error.id)).toMatchObject({
      status: 'resuelto',
      resolvedBy: 'reintento_manual',
      resolvedByUserId: user.id,
      resolvedAt: NOW,
    });
  });

  it('si la factura se genera pero el email falla, el error de generación se resuelve y queda uno de envío', async () => {
    const { t, client, error } = generationError();
    t.adapters.mailSender.steps.push(new Error('Gmail rechazó el envío'));
    const { agent } = await loggedInAgent(t, { role: 'admin' });

    const res = await agent.post(`/api/review/errors/${error.id}/retry`);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('reintento_fallido');
    expect(errorRow(t, error.id)?.status).toBe('resuelto');
    const pending = t.db.select().from(processErrors).where(eq(processErrors.status, 'pendiente')).all();
    expect(pending).toEqual([
      expect.objectContaining({ operation: 'envio_factura', clientId: client.id, period: '2026-10', attempts: 1 }),
    ]);
    expect(t.db.select().from(retryQueue).all()).toHaveLength(0);
  });

  it('AC-189: reintentar un envío reenvía solo el email, sin generar otra factura en ARCA, y pasa el error a Resuelto', async () => {
    const { t, invoice, error } = sendError();
    const { agent } = await loggedInAgent(t, { role: 'admin' });

    const res = await agent.post(`/api/review/errors/${error.id}/retry`);

    expect(res.status).toBe(200);
    expect(t.adapters.arca.requests).toHaveLength(0);
    expect(t.db.select().from(invoices).all()).toHaveLength(1);
    expect(invoiceEmails(t)).toEqual([
      expect.objectContaining({ invoiceId: invoice.id, trigger: 'reintento_manual' }),
    ]);
    expect(errorRow(t, error.id)?.status).toBe('resuelto');
  });

  it('AC-190: si el servicio sigue fallando, hace un único intento y el error sigue Pendiente con el nuevo mensaje', async () => {
    const { t, error } = generationError();
    t.adapters.arca.caeSteps.push(timeout('WSFEv1'), timeout('WSFEv1'));
    const { agent } = await loggedInAgent(t, { role: 'editor' });

    const res = await agent.post(`/api/review/errors/${error.id}/retry`);

    expect(res.status).toBe(502);
    expect(res.body.error).toMatchObject({ code: 'reintento_fallido', message: expect.stringContaining('WSFEv1') });
    expect(t.adapters.arca.requests).toHaveLength(1);
    expect(t.adapters.mailSender.attempts).toHaveLength(0);
    expect(errorRow(t, error.id)).toMatchObject({
      status: 'pendiente',
      attempts: 5,
      lastErrorMessage: 'WSFEv1 no respondió a tiempo',
    });
    // RF-183: una acción de un usuario no se reintenta sola.
    expect(t.db.select().from(retryQueue).all()).toHaveLength(0);
  });

  it('AC-190: un reenvío que vuelve a fallar deja el error Pendiente con el nuevo mensaje', async () => {
    const { t, error } = sendError();
    t.adapters.mailSender.steps.push(new Error('Gmail sigue rechazando'));
    const { agent } = await loggedInAgent(t, { role: 'editor' });

    const res = await agent.post(`/api/review/errors/${error.id}/retry`);

    expect(res.status).toBe(502);
    expect(t.adapters.mailSender.attempts).toHaveLength(1);
    expect(errorRow(t, error.id)).toMatchObject({ status: 'pendiente', lastErrorMessage: 'Gmail sigue rechazando' });
  });

  it('AC-248: si el cliente fue dado de baja, bloquea el reintento con un mensaje, no llama a ARCA y el error sigue Pendiente', async () => {
    const { t, client, error } = generationError();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    await agent.post(`/api/clients/${client.id}/deactivate`);

    const res = await agent.post(`/api/review/errors/${error.id}/retry`);

    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'cliente_no_facturable',
      message: expect.stringMatching(/Inactivo/),
    });
    expect(t.adapters.arca.requests).toHaveLength(0);
    expect(errorRow(t, error.id)).toMatchObject({ status: 'pendiente', attempts: 4 });
  });

  it('RF-177: si el cliente no tiene productos Activos asignados, bloquea el reintento con un mensaje', async () => {
    const { t, product, error } = generationError();
    t.db.update(products).set({ status: 'inactivo' }).where(eq(products.id, product.id)).run();
    const { agent } = await loggedInAgent(t, { role: 'admin' });

    const res = await agent.post(`/api/review/errors/${error.id}/retry`);

    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'cliente_no_facturable',
      message: expect.stringMatching(/productos Activos/),
    });
    expect(t.adapters.arca.requests).toHaveLength(0);
    expect(errorRow(t, error.id)?.status).toBe('pendiente');
  });

  it('un error de revisión de la casilla no se reintenta a mano: se reintenta solo en la siguiente revisión', async () => {
    const t = createTestApp({ now: NOW });
    const error = recordProcessError(t.db, {
      operation: 'revision_casilla',
      attempts: 1,
      message: 'IMAP caído',
      now: at,
    });
    const { agent } = await loggedInAgent(t, { role: 'admin' });

    const res = await agent.post(`/api/review/errors/${error.id}/retry`);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('no_reintentable');
    expect(errorRow(t, error.id)?.status).toBe('pendiente');
  });

  it('un error ya Resuelto no se reintenta ni se resuelve otra vez (409), y uno inexistente da 404', async () => {
    const { t, error } = sendError();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    await agent.post(`/api/review/errors/${error.id}/resolve`);

    expect((await agent.post(`/api/review/errors/${error.id}/retry`)).status).toBe(409);
    expect((await agent.post(`/api/review/errors/${error.id}/resolve`)).status).toBe(409);
    expect((await agent.post('/api/review/errors/999/retry')).status).toBe(404);
    expect(t.adapters.mailSender.attempts).toHaveLength(0);
  });

  it('RF-13: un usuario Consulta no puede reintentar ni resolver', async () => {
    const { t, error } = sendError();
    const { agent } = await loggedInAgent(t, { role: 'consulta' });

    expect((await agent.post(`/api/review/errors/${error.id}/retry`)).status).toBe(403);
    expect((await agent.post(`/api/review/errors/${error.id}/resolve`)).status).toBe(403);
    expect(errorRow(t, error.id)?.status).toBe('pendiente');
  });
});

describe('marcar un error como Resuelto (RF-180)', () => {
  it('AC-191: deja de aparecer entre los Pendientes y queda registrado qué usuario lo resolvió', async () => {
    const { t, error } = sendError();
    const { agent, user } = await loggedInAgent(t, { role: 'editor' });

    const res = await agent.post(`/api/review/errors/${error.id}/resolve`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'resuelto' });
    expect((await agent.get('/api/review/errors')).body).toEqual([]);
    expect(errorRow(t, error.id)).toMatchObject({
      status: 'resuelto',
      resolvedBy: 'usuario',
      resolvedByUserId: user.id,
      resolvedAt: NOW,
    });
    expect(t.adapters.mailSender.attempts).toHaveLength(0);
  });
});

describe('banner de errores en el dashboard (RF-181)', () => {
  it('AC-192: con dos errores Pendientes, el banner muestra la cantidad 2', async () => {
    const { t, client } = generationError();
    recordProcessError(t.db, {
      operation: 'envio_factura',
      clientId: client.id,
      period: '2026-09',
      attempts: 4,
      message: 'x',
      now: at,
    });
    const { agent } = await loggedInAgent(t, { role: 'consulta' });

    const res = await agent.get('/api/dashboard');

    expect(res.body.banners.processErrors).toEqual({ count: 2, message: expect.stringContaining('2') });
  });

  it('AC-193: cuando el único error Pendiente pasa a Resuelto, el banner deja de mostrarse', async () => {
    const { t, error } = sendError();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    expect((await agent.get('/api/dashboard')).body.banners.processErrors).toMatchObject({ count: 1 });

    await agent.post(`/api/review/errors/${error.id}/resolve`);

    expect((await agent.get('/api/dashboard')).body.banners.processErrors).toBeNull();
  });
});

describe('acciones de un usuario que fallan (RF-182, RF-183)', () => {
  it('AC-194: un recordatorio manual que falla muestra el error, hace un único intento y no registra un error de proceso', async () => {
    const t = createTestApp({ now: NOW });
    configureIssuer(t.db);
    const client = insertClient(t.db, { billingEmail: 'pagos@losandes.com' });
    insertInvoice(t.db, { clientId: client.id, period: '2026-10', number: 1 });
    t.adapters.mailSender.steps.push(new Error('Gmail rechazó el envío'));
    const { agent } = await loggedInAgent(t, { role: 'consulta' });

    const res = await agent.post(`/api/clients/${client.id}/reminder`);

    expect(res.status).toBe(502);
    expect(res.body.error.message).toMatch(/no se pudo enviar el recordatorio/i);
    expect(t.adapters.mailSender.attempts).toHaveLength(1);
    expect(t.db.select().from(processErrors).all()).toHaveLength(0);
    expect(t.db.select().from(retryQueue).all()).toHaveLength(0);
  });
});
