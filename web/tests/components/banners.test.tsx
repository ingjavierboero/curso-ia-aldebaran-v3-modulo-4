import type { DashboardDto, UserDto } from '@api-types';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Banners } from '../../src/components/Banners.tsx';
import { useSessionStore } from '../../src/stores/session.ts';
import { ThemeProvider } from '../../src/theme/theme.tsx';

const EXCHANGE = {
  rateCents: 152_000,
  readAt: '2026-09-20T14:00:00.000Z',
  usedAt: '2026-10-15T14:00:00.000Z',
  message: 'dolarhoy.com no respondió: se facturó con la última cotización registrada, $ 1.520,00, leída el 20/09/2026.',
};
const CERTIFICATE = {
  status: 'vencido' as const,
  expiresAt: '2026-10-14',
  message: 'El certificado de ARCA venció el 14/10/2026: no se puede realizar la facturación.',
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

function mockDashboard(banners: DashboardDto['banners']) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    url === '/api/dashboard/exchange-rate/confirm' && init?.method === 'POST'
      ? json({ banners: { ...banners, exchangeRate: null } })
      : json({ banners }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderAs(role: UserDto['role']) {
  useSessionStore.setState({
    user: { id: 9, name: 'Usuario', email: 'u@empresa.com', role, status: 'activo' },
    userChecked: true,
  });
  render(
    <ThemeProvider>
      <Banners />
    </ThemeProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('banners del dashboard', () => {
  it('AC-90: muestra el banner de certificado con su mensaje', async () => {
    mockDashboard({ certificate: CERTIFICATE, exchangeRate: null, processErrors: null });
    renderAs('consulta');
    expect(await screen.findByText(CERTIFICATE.message)).toBeTruthy();
  });

  it('AC-69, RF-70: un Editor confirma la cotización desde el banner y el banner deja de mostrarse', async () => {
    const fetchMock = mockDashboard({ certificate: null, exchangeRate: EXCHANGE, processErrors: null });
    renderAs('editor');
    expect(await screen.findByText(EXCHANGE.message)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/dashboard/exchange-rate/confirm', expect.objectContaining({ method: 'POST' }));
    expect(screen.queryByText(EXCHANGE.message)).toBeNull();
  });

  it('RF-13: un usuario Consulta ve el banner de cotización sin el botón para confirmarla', async () => {
    mockDashboard({ certificate: null, exchangeRate: EXCHANGE, processErrors: null });
    renderAs('consulta');
    expect(await screen.findByText(EXCHANGE.message)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /confirmar/i })).toBeNull();
  });

  it('sin nada que avisar no muestra ningún banner', async () => {
    const fetchMock = mockDashboard({ certificate: null, exchangeRate: null, processErrors: null });
    renderAs('admin');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
