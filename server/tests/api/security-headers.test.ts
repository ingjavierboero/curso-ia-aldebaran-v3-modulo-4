import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { createTestApp, loggedInAgent } from '../helpers/test-app.ts';

/** Directivas de una Content-Security-Policy: nombre → fuentes. */
function cspDirectives(header: string | undefined): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of (header ?? '').split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives.set(name, sources);
  }
  return directives;
}

function expectCommonHeaders(res: request.Response) {
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['x-frame-options']).toBe('DENY');
  expect(res.headers['referrer-policy']).toBe('same-origin');
}

describe('headers de seguridad de la API (RNF-16, research R-16)', () => {
  it('toda respuesta de la API, con o sin sesión y también los errores, lleva los headers y una CSP restrictiva', async () => {
    const t = createTestApp();
    const { agent } = await loggedInAgent(t, { role: 'admin' });
    const responses: Array<[string, request.Response]> = [
      ['pública', await request(t.app).get('/api/setup')],
      ['401 sin sesión', await request(t.app).get('/api/auth/me')],
      ['con sesión', await agent.get('/api/settings')],
      ['404', await agent.get('/api/no-existe')],
      ['400', await agent.put('/api/settings').send({ retryCount: 99 })],
    ];
    for (const [name, res] of responses) {
      expectCommonHeaders(res);
      const csp = cspDirectives(res.headers['content-security-policy']);
      expect(csp.get('default-src'), name).toEqual(["'none'"]);
      expect(csp.get('frame-ancestors'), name).toEqual(["'none'"]);
    }
  });
});

describe('web compilada servida por Express con npm start (AC-256)', () => {
  const webDir = mkdtempSync(join(tmpdir(), 'aldebaran-web-'));
  writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Aldebaran</title><script type="module" src="/assets/app.js"></script>');
  mkdirSync(join(webDir, 'assets'));
  writeFileSync(join(webDir, 'assets', 'app.js'), 'console.log("app");');
  afterAll(() => rmSync(webDir, { recursive: true, force: true }));

  const webApp = () => {
    const t = createTestApp();
    return createApp(t.ctx, { log: () => {}, webDir });
  };

  it('AC-256: la pantalla responde con una CSP que solo permite scripts del propio sistema', async () => {
    const res = await request(webApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<title>Aldebaran</title>');
    expectCommonHeaders(res);
    const csp = cspDirectives(res.headers['content-security-policy']);
    expect(csp.get('default-src')).toEqual(["'self'"]);
    expect(csp.get('script-src')).toEqual(["'self'"]);
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
  });

  it('las rutas de la web devuelven el index.html con la misma CSP, y los archivos compilados también la llevan', async () => {
    const app = webApp();
    const route = await request(app).get('/clientes/12');
    expect(route.status).toBe(200);
    expect(route.text).toContain('<title>Aldebaran</title>');
    expect(cspDirectives(route.headers['content-security-policy']).get('script-src')).toEqual(["'self'"]);

    const asset = await request(app).get('/assets/app.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['x-content-type-options']).toBe('nosniff');
    expect(cspDirectives(asset.headers['content-security-policy']).get('script-src')).toEqual(["'self'"]);
  });

  it('una ruta inexistente de la API sigue respondiendo el error JSON de la API, no la web', async () => {
    const res = await request(webApp()).get('/api/no-existe');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('sin_sesion');
  });

  it('sin web compilada, Express no sirve la web', async () => {
    const t = createTestApp();
    const app = createApp(t.ctx, { log: () => {}, webDir: join(webDir, 'no-existe') });
    expect((await request(app).get('/')).status).toBe(404);
  });
});
