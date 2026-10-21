import { describe, expect, it } from 'vitest';
import { createTestApp, loggedInAgent } from '../helpers/test-app.ts';
import { TEST_PASSWORD } from '../helpers/test-db.ts';

const HOUR = 60 * 60 * 1000;

describe('vencimiento de la sesión por inactividad (RNF-10)', () => {
  it('AC-223: con la última actividad hace 23 h, la acción se ejecuta sin pedir iniciar sesión', async () => {
    const t = createTestApp({ now: '2026-10-20T12:00:00Z' });
    const { agent } = await loggedInAgent(t);

    t.adapters.clock.advance(23 * HOUR);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
  });

  it('AC-222: sin actividad durante 24 h, la siguiente acción exige iniciar sesión de nuevo', async () => {
    const t = createTestApp({ now: '2026-10-20T12:00:00Z' });
    const { agent } = await loggedInAgent(t);

    t.adapters.clock.advance(24 * HOUR);
    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('sin_sesion');
  });

  it('el vencimiento es deslizante: cada acción reinicia el plazo de 24 h', async () => {
    const t = createTestApp({ now: '2026-10-20T12:00:00Z' });
    const { agent } = await loggedInAgent(t);

    t.adapters.clock.advance(20 * HOUR);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    t.adapters.clock.advance(20 * HOUR); // 40 h desde el login, 20 h desde la última actividad
    expect((await agent.get('/api/auth/me')).status).toBe(200);
  });

  it('una sesión vencida no vuelve a valer aunque se use enseguida de nuevo', async () => {
    const t = createTestApp({ now: '2026-10-20T12:00:00Z' });
    const { agent } = await loggedInAgent(t);

    t.adapters.clock.advance(25 * HOUR);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    t.adapters.clock.set('2026-10-20T12:00:00Z');
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('después del vencimiento se puede iniciar sesión de nuevo', async () => {
    const t = createTestApp({ now: '2026-10-20T12:00:00Z' });
    const { agent, user } = await loggedInAgent(t);

    t.adapters.clock.advance(24 * HOUR);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    const login = await agent.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
  });
});
