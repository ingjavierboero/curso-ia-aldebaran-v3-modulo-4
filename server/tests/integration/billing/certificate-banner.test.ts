import { describe, expect, it } from 'vitest';
import { createTestApp, loggedInAgent } from '../../helpers/test-app.ts';

/** 15/10/2026 a las 11:00 de Argentina. */
const NOW = new Date('2026-10-15T14:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(NOW.getTime() + days * DAY);

/** Banner de certificado que ve un usuario autenticado al abrir el dashboard. */
async function certificateBanner(certificate: { readable: boolean; notAfter: Date | null }) {
  const t = createTestApp({ now: NOW });
  t.adapters.arca.certificate = certificate;
  const { agent } = await loggedInAgent(t, { role: 'consulta' });
  const res = await agent.get('/api/dashboard');
  expect(res.status).toBe(200);
  return res.body.banners.certificate as { status: string; expiresAt: string | null; message: string } | null;
}

describe('banner de certificado de ARCA (RF-97, RF-98)', () => {
  it('AC-90: con el certificado vencido, el banner indica que no se puede facturar', async () => {
    const banner = await certificateBanner({ readable: true, notAfter: inDays(-1) });
    expect(banner).toMatchObject({ status: 'vencido', expiresAt: '2026-10-14' });
    expect(banner?.message).toMatch(/no se puede realizar la facturación/i);
  });

  it('AC-90: si el certificado no se puede leer, el banner indica que no se puede facturar', async () => {
    const banner = await certificateBanner({ readable: false, notAfter: null });
    expect(banner).toMatchObject({ status: 'ilegible', expiresAt: null });
    expect(banner?.message).toMatch(/no se puede realizar la facturación/i);
  });

  it('AC-91: si vence dentro de 30 días, el banner muestra la fecha de vencimiento y avisa que hay que renovarlo', async () => {
    const banner = await certificateBanner({ readable: true, notAfter: inDays(30) });
    expect(banner).toMatchObject({ status: 'por_vencer', expiresAt: '2026-11-14' });
    expect(banner?.message).toContain('14/11/2026');
    expect(banner?.message).toMatch(/renov/i);
  });

  it('AC-91: si vence mañana también avisa', async () => {
    expect(await certificateBanner({ readable: true, notAfter: inDays(1) })).toMatchObject({ status: 'por_vencer' });
  });

  it('AC-91: si vence dentro de 31 días, no hay banner', async () => {
    expect(await certificateBanner({ readable: true, notAfter: inDays(31) })).toBeNull();
  });

  it('AC-90: con un certificado legible al que le faltan más de 30 días, no hay banner', async () => {
    expect(await certificateBanner({ readable: true, notAfter: new Date('2028-01-01T00:00:00Z') })).toBeNull();
  });
});
