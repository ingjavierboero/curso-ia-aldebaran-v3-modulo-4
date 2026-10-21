import { describe, expect, it } from 'vitest';
import { settings } from '../../src/db/schema.ts';
import { createTestApp, loggedInAgent } from '../helpers/test-app.ts';

const current = (t: ReturnType<typeof createTestApp>) => t.db.select().from(settings).get();

describe('lectura de la configuración (RF-09, RF-11)', () => {
  it('Admin, Editor y Consulta ven la configuración, con los valores por defecto del PRD y el CUIT emisor', async () => {
    const t = createTestApp({ env: { arcaCuit: '30711111111' } });
    for (const role of ['admin', 'editor', 'consulta'] as const) {
      const { agent } = await loggedInAgent(t, { role });
      const res = await agent.get('/api/settings');
      expect(res.status, role).toBe(200);
      expect(res.body, role).toMatchObject({
        mailboxIntervalMinutes: 15,
        billingTime: '11:00',
        remindersTime: '11:00',
        retryCount: 3,
        retryWaitMinutes: 5,
        pointOfSale: null,
        issuerCuit: '30711111111',
      });
    }
  });
});

describe('modificación de la configuración por un Admin', () => {
  it('AC-06: un Admin modifica el intervalo de revisión de la casilla y el valor nuevo queda guardado', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const res = await agent.put('/api/settings').send({ mailboxIntervalMinutes: 30 });
    expect(res.status).toBe(200);
    expect(res.body.mailboxIntervalMinutes).toBe(30);
    expect(current(t)?.mailboxIntervalMinutes).toBe(30);
    // Los valores no enviados no cambian.
    expect(current(t)?.billingTime).toBe('11:00');
  });

  it('guarda todos los valores de la configuración y los datos de la empresa emisora (RF-62, RF-73, RF-91, RF-152, RF-172, RF-173)', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const values = {
      mailboxIntervalMinutes: 5,
      billingTime: '14:00',
      remindersTime: '09:30',
      retryCount: 0,
      retryWaitMinutes: 60,
      pointOfSale: 3,
      issuerBusinessName: 'Molina Hernando Agustina Maria',
      issuerAddress: 'Calle Falsa 123, CABA',
      issuerIvaCondition: 'Responsable Monotributo',
      issuerGrossIncomeNumber: '901-123456-7',
      issuerActivityStartDate: '2020-01-01',
      issuerTradeName: 'Estudio Molina',
    };
    const res = await agent.put('/api/settings').send(values);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject(values);
    expect(current(t)).toMatchObject(values);
  });

  it('el nombre de fantasía es opcional y se puede quitar (RF-91, RF-215)', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    await agent.put('/api/settings').send({ issuerTradeName: 'Estudio Molina' });
    const res = await agent.put('/api/settings').send({ issuerTradeName: null });
    expect(res.status).toBe(200);
    expect(current(t)?.issuerTradeName).toBeNull();
  });

  it('los límites de cada rango se aceptan', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const accepted = [
      { billingTime: '00:00' },
      { billingTime: '23:59' },
      { remindersTime: '23:59' },
      { pointOfSale: 1 },
      { pointOfSale: 99999 },
      { mailboxIntervalMinutes: 60 },
      { retryCount: 10 },
      { retryWaitMinutes: 1 },
    ];
    for (const body of accepted) expect((await agent.put('/api/settings').send(body)).status, JSON.stringify(body)).toBe(200);
  });
});

describe('valores fuera de rango (se rechazan y se conserva el anterior)', () => {
  const rejected: Array<[string, Record<string, unknown>, string]> = [
    ['AC-62: hora de facturación 24:00', { billingTime: '24:00' }, 'billingTime'],
    ['AC-62: hora de facturación 23:60', { billingTime: '23:60' }, 'billingTime'],
    ['AC-160: hora de recordatorios 24:00', { remindersTime: '24:00' }, 'remindersTime'],
    ['AC-160: hora de recordatorios 23:60', { remindersTime: '23:60' }, 'remindersTime'],
    ['hora con formato inválido', { billingTime: '9:00' }, 'billingTime'],
    ['AC-71: punto de venta 0', { pointOfSale: 0 }, 'pointOfSale'],
    ['AC-71: punto de venta 100000', { pointOfSale: 100000 }, 'pointOfSale'],
    ['punto de venta no entero', { pointOfSale: 3.5 }, 'pointOfSale'],
    ['AC-94: intervalo de revisión 4', { mailboxIntervalMinutes: 4 }, 'mailboxIntervalMinutes'],
    ['AC-94: intervalo de revisión 61', { mailboxIntervalMinutes: 61 }, 'mailboxIntervalMinutes'],
    ['AC-183: cantidad de reintentos 11', { retryCount: 11 }, 'retryCount'],
    ['cantidad de reintentos negativa', { retryCount: -1 }, 'retryCount'],
    ['AC-185: espera entre reintentos 0', { retryWaitMinutes: 0 }, 'retryWaitMinutes'],
    ['AC-185: espera entre reintentos 61', { retryWaitMinutes: 61 }, 'retryWaitMinutes'],
    ['fecha de inicio de actividades inválida', { issuerActivityStartDate: '2020-13-45' }, 'issuerActivityStartDate'],
  ];

  for (const [name, body, field] of rejected) {
    it(name, async () => {
      const t = createTestApp();
      const { agent } = await loggedInAgent(t, { role: 'admin' });
      const before = current(t);
      const res = await agent.put('/api/settings').send(body);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.error.details)).toContain(field);
      expect(current(t)).toEqual(before);
    });
  }

  it('si un valor es inválido, no se guarda ninguno de los enviados en la misma solicitud', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const res = await agent.put('/api/settings').send({ mailboxIntervalMinutes: 30, retryCount: 11 });
    expect(res.status).toBe(400);
    expect(current(t)?.mailboxIntervalMinutes).toBe(15);
  });
});

describe('permisos (RF-10, RF-13)', () => {
  it('AC-215: un Editor o un usuario Consulta no puede cambiar ningún valor de la configuración y el valor no cambia', async () => {
    const t = createTestApp();
    const attempts = [
      { mailboxIntervalMinutes: 30 },
      { billingTime: '14:00' },
      { remindersTime: '14:00' },
      { retryCount: 5 },
      { retryWaitMinutes: 10 },
      { pointOfSale: 5 },
      { issuerBusinessName: 'Otra empresa' },
    ];
    for (const role of ['editor', 'consulta'] as const) {
      const { agent } = await loggedInAgent(t, { role });
      const before = current(t);
      for (const body of attempts) {
        expect((await agent.put('/api/settings').send(body)).status, `${role} ${JSON.stringify(body)}`).toBe(403);
      }
      expect(current(t)).toEqual(before);
    }
  });
});
