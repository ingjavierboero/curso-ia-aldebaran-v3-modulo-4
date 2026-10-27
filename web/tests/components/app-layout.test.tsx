import { act, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppLayout } from '../../src/components/AppLayout.tsx';

/** Simula `GET /api/setup` con la redirección de emails indicada. */
function mockSetup(emailRedirectTo: string | null) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ needsFirstAdmin: false, mode: 'homologacion', emailRedirectTo }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderLayout(initialPath = '/') {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <AppLayout />,
        children: [
          { index: true, element: <p>Dashboard</p> },
          { path: 'clientes', element: <p>Clientes</p> },
        ],
      },
    ],
    { initialEntries: [initialPath] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

afterEach(() => vi.unstubAllGlobals());

describe('arranque sin conexión con el server (plan.md, Diseño de la interfaz)', () => {
  it('si el server no responde muestra un error con "Reintentar", que vuelve a intentar', async () => {
    const fetchMock = vi.fn(async (): Promise<Response> => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);
    renderLayout();
    expect(await screen.findByText('No se pudo cargar Aldebaran')).toBeTruthy();

    mockSetup('dev@empresa.com');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));
    });
    expect(await screen.findByText('Emails redirigidos a dev@empresa.com')).toBeTruthy();
    expect(screen.queryByText('No se pudo cargar Aldebaran')).toBeNull();
  });
});

describe('indicador de redirección de emails en el header (RF-220)', () => {
  it('AC-250: con EMAIL_REDIRECT_TO definida, el header muestra "Emails redirigidos a <dirección>"', async () => {
    const fetchMock = mockSetup('dev@empresa.com');
    renderLayout();
    expect(await screen.findByText('Emails redirigidos a dev@empresa.com')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/setup', expect.objectContaining({ method: 'GET' }));
  });

  it('AC-250: el indicador se ve en todas las pantallas', async () => {
    mockSetup('dev@empresa.com');
    const router = renderLayout();
    expect(await screen.findByText('Emails redirigidos a dev@empresa.com')).toBeTruthy();

    await act(async () => {
      await router.navigate('/clientes');
    });
    expect(screen.getByText('Clientes')).toBeTruthy();
    expect(screen.getByText('Emails redirigidos a dev@empresa.com')).toBeTruthy();
  });

  it('AC-250: sin la variable, el indicador no se muestra', async () => {
    mockSetup(null);
    renderLayout();
    expect(await screen.findByText('Dashboard')).toBeTruthy();
    // Se espera a que termine la consulta de /api/setup antes de comprobar que no hay indicador.
    await act(async () => {});
    expect(screen.queryByText(/Emails redirigidos a/)).toBeNull();
  });
});
