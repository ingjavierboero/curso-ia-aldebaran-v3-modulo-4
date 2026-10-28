import { describe, expect, it } from 'vitest';
import { agent as anonymous, createTestApp, loggedInAgent, type TestApp } from '../helpers/test-app.ts';
import { insertClient, insertInvoice } from '../helpers/test-db.ts';

const NOW = '2026-10-20T13:00:00.000Z';

/** Filas de un CSV (separado por `;`, con BOM para Excel), sin la fila de encabezados. */
function csvRows(text: string): { header: string[]; rows: string[][] } {
  expect(text.startsWith('﻿')).toBe(true);
  const [header = '', ...rows] = text.slice(1).trimEnd().split('\r\n');
  return { header: header.split(';'), rows: rows.map((row) => row.split(';')) };
}

/** Pide el CSV de un reporte y verifica que sea una descarga CSV. */
async function downloadCsv(agent: Awaited<ReturnType<typeof loggedInAgent>>['agent'], url: string, filename: string) {
  const res = await agent.get(url);
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
  expect(res.headers['content-disposition']).toBe(`attachment; filename="${filename}"`);
  return csvRows(res.text);
}

type Status = 'pendiente_de_pago' | 'pago_recibido' | 'revision_manual' | 'pagada' | 'generando';

/** Facturas de agosto, septiembre y octubre de 2026 (AC-171, AC-172, AC-177); cada una de un cliente nuevo. */
function invoicesScenario() {
  const t = createTestApp({ now: NOW });
  let number = 0;
  const invoice = (period: string, totalCents: number, status: Status = 'pendiente_de_pago') =>
    insertInvoice(t.db, {
      clientId: insertClient(t.db).id,
      period,
      number: status === 'generando' ? null : ++number,
      totalCents,
      status,
    });
  invoice('2026-08', 700_000, 'pagada');
  // Septiembre: tres facturas por $10.000, $20.000 y $30.000, todas Pagadas.
  invoice('2026-09', 1_000_000, 'pagada');
  invoice('2026-09', 2_000_000, 'pagada');
  invoice('2026-09', 3_000_000, 'pagada');
  // Octubre: A Pagada, B en Pago recibido, C Pendiente de pago y D en Revisión manual (AC-172).
  invoice('2026-10', 1_000_000, 'pagada');
  invoice('2026-10', 2_000_000, 'pago_recibido');
  invoice('2026-10', 3_000_000);
  invoice('2026-10', 4_000_000, 'revision_manual');
  // Una factura que todavía se está generando no cuenta.
  invoice('2026-10', 9_900_000, 'generando');
  return { t };
}

describe('reporte de facturación por período (RF-164, RF-170)', () => {
  it('AC-171: indica por período la cantidad de facturas emitidas y su total en pesos', async () => {
    const t = createTestApp({ now: NOW });
    for (const [period, totalCents] of [
      ['2026-09', 1_000_000],
      ['2026-09', 2_000_000],
      ['2026-09', 3_000_000],
      ['2026-10', 500_000],
      ['2026-10', 500_000],
    ] as const) {
      insertInvoice(t.db, { clientId: insertClient(t.db).id, period, totalCents });
    }
    const { agent } = await loggedInAgent(t, { role: 'consulta' });

    const res = await agent.get('/api/reports/billing');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { period: '2026-09', invoiceCount: 3, totalCents: 6_000_000 },
      { period: '2026-10', invoiceCount: 2, totalCents: 1_000_000 },
    ]);
  });

  it('AC-177: filtrado de septiembre a octubre muestra solo esos períodos, y el CSV solo esas filas', async () => {
    const { t } = invoicesScenario();
    const { agent } = await loggedInAgent(t, { role: 'consulta' });

    const res = await agent.get('/api/reports/billing?from=2026-09&to=2026-10');
    expect(res.body.map((row: { period: string }) => row.period)).toEqual(['2026-09', '2026-10']);

    const csv = await downloadCsv(
      agent,
      '/api/reports/billing?from=2026-09&to=2026-10&format=csv',
      'reporte-facturacion-2026-09-a-2026-10.csv',
    );
    expect(csv.header).toEqual(['Período', 'Facturas emitidas', 'Total facturado']);
    expect(csv.rows).toEqual([
      ['2026-09', '3', '60000,00'],
      ['2026-10', '4', '100000,00'],
    ]);
  });

  it('con solo una de las puntas, filtra desde o hasta ese período', async () => {
    const { t } = invoicesScenario();
    const { agent } = await loggedInAgent(t, { role: 'consulta' });
    const periods = async (query: string) =>
      (await agent.get(`/api/reports/billing${query}`)).body.map((row: { period: string }) => row.period);
    expect(await periods('?from=2026-09')).toEqual(['2026-09', '2026-10']);
    expect(await periods('?to=2026-08')).toEqual(['2026-08']);
  });

  it('rechaza un período inválido o un rango invertido', async () => {
    const { t } = invoicesScenario();
    const { agent } = await loggedInAgent(t, { role: 'consulta' });
    expect((await agent.get('/api/reports/billing?from=2026-13')).status).toBe(400);
    expect((await agent.get('/api/reports/collections?from=2026-10&to=2026-09')).status).toBe(400);
  });
});

describe('reporte de cobranza por período (RF-165, RF-170)', () => {
  it('AC-172: indica por período el total facturado y la parte Pagada, en Pago recibido y adeudada', async () => {
    const { t } = invoicesScenario();
    const { agent } = await loggedInAgent(t, { role: 'consulta' });

    const res = await agent.get('/api/reports/collections?from=2026-10&to=2026-10');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        period: '2026-10',
        totalCents: 10_000_000,
        paidCents: 1_000_000,
        paymentReceivedCents: 2_000_000,
        owedCents: 7_000_000,
      },
    ]);
  });

  it('AC-174, AC-177: el CSV tiene las mismas filas y columnas que el reporte, también filtrado', async () => {
    const { t } = invoicesScenario();
    const { agent } = await loggedInAgent(t, { role: 'editor' });

    const report = (await agent.get('/api/reports/collections?from=2026-09&to=2026-10')).body;
    const csv = await downloadCsv(
      agent,
      '/api/reports/collections?from=2026-09&to=2026-10&format=csv',
      'reporte-cobranza-2026-09-a-2026-10.csv',
    );

    expect(csv.header).toEqual(['Período', 'Total facturado', 'Pagada', 'Pago recibido', 'Adeudada']);
    expect(csv.rows).toHaveLength(report.length);
    expect(csv.rows).toEqual([
      ['2026-09', '60000,00', '60000,00', '0,00', '0,00'],
      ['2026-10', '100000,00', '10000,00', '20000,00', '70000,00'],
    ]);
  });
});

describe('reporte de deuda por cliente (RF-166)', () => {
  /** Los Andes debe $10.000 y $12.000; Alfil no tiene deuda vigente. */
  function debtScenario() {
    const t = createTestApp({ now: NOW });
    const andes = insertClient(t.db, { businessName: 'Los Andes SA' });
    insertInvoice(t.db, { clientId: andes.id, period: '2026-08', number: 1, totalCents: 1_000_000 });
    insertInvoice(t.db, {
      clientId: andes.id,
      period: '2026-09',
      number: 2,
      totalCents: 1_200_000,
      status: 'revision_manual',
    });
    const alfil = insertClient(t.db, { businessName: 'Librería Alfil' });
    insertInvoice(t.db, { clientId: alfil.id, period: '2026-09', number: 3, status: 'pagada' });
    insertInvoice(t.db, { clientId: alfil.id, period: '2026-10', number: 4, status: 'pago_recibido' });
    return { t, andes };
  }

  it('AC-173: lista cada cliente con deuda vigente con su total y el detalle de sus facturas adeudadas', async () => {
    const { t, andes } = debtScenario();
    const { agent } = await loggedInAgent(t, { role: 'consulta' });

    const res = await agent.get('/api/reports/debt');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        clientId: andes.id,
        businessName: 'Los Andes SA',
        debtCents: 2_200_000,
        invoices: [
          {
            invoiceId: expect.any(Number),
            voucherNumber: '00001-00000001',
            period: '2026-08',
            totalCents: 1_000_000,
            dueDate: '2026-08-31',
            status: 'pendiente_de_pago',
          },
          {
            invoiceId: expect.any(Number),
            voucherNumber: '00001-00000002',
            period: '2026-09',
            totalCents: 1_200_000,
            dueDate: '2026-09-30',
            status: 'revision_manual',
          },
        ],
      },
    ]);
  });

  it('AC-174: el CSV tiene una fila por factura adeudada, con las mismas columnas que el reporte', async () => {
    const { t } = debtScenario();
    const { agent } = await loggedInAgent(t, { role: 'admin' });

    const csv = await downloadCsv(agent, '/api/reports/debt?format=csv', 'reporte-deuda.csv');

    expect(csv.header).toEqual([
      'Cliente',
      'Deuda vigente',
      'Factura',
      'Período',
      'Importe',
      'Vencimiento',
      'Estado',
    ]);
    expect(csv.rows).toEqual([
      ['Los Andes SA', '22000,00', '00001-00000001', '2026-08', '10000,00', '31/08/2026', 'Pendiente de pago'],
      ['Los Andes SA', '22000,00', '00001-00000002', '2026-09', '12000,00', '30/09/2026', 'Revisión manual'],
    ]);
  });

  it('el CSV escapa los valores con el separador o comillas', async () => {
    const t = createTestApp({ now: NOW });
    const client = insertClient(t.db, { businessName: 'Pérez; Gómez "y asociados"' });
    insertInvoice(t.db, { clientId: client.id, period: '2026-10', number: 1, totalCents: 100 });
    const { agent } = await loggedInAgent(t, { role: 'consulta' });

    const res = await agent.get('/api/reports/debt?format=csv');

    expect(res.text).toContain('"Pérez; Gómez ""y asociados"""');
  });
});

describe('acceso a los reportes (RF-167)', () => {
  it('sin sesión no se pueden ver ni descargar', async () => {
    const t: TestApp = createTestApp({ now: NOW });
    expect((await anonymous(t).get('/api/reports/billing')).status).toBe(401);
    expect((await anonymous(t).get('/api/reports/debt?format=csv')).status).toBe(401);
  });

  it('rechaza un formato desconocido', async () => {
    const t = createTestApp({ now: NOW });
    const { agent } = await loggedInAgent(t, { role: 'consulta' });
    expect((await agent.get('/api/reports/debt?format=xlsx')).status).toBe(400);
  });
});
