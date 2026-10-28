import type { SetupInfo, UserDto } from '@api-types';
import { act, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLayout } from '../../src/components/AppLayout.tsx';
import { LoginPage } from '../../src/pages/LoginPage.tsx';
import { useSessionStore } from '../../src/stores/session.ts';

const MOCK_INDICATOR = 'Modo mock: ARCA, LLM y email simulados';
const USER: UserDto = { id: 1, name: 'Ana María Pérez', email: 'ana@empresa.com', role: 'consulta', status: 'activo' };

/** Simula `GET /api/setup` en el modo indicado. */
function mockSetup(mode: SetupInfo['mode']) {
  const setup: SetupInfo = { needsFirstAdmin: false, mode, emailRedirectTo: null };
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(setup), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ),
  );
}

function renderApp(initialPath: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <AppLayout />,
        children: [
          { index: true, element: <p>Dashboard</p> },
          { path: 'clientes', element: <p>Pantalla de clientes</p> },
          { path: 'login', element: <LoginPage /> },
          { path: 'recuperar-contrasena', element: <p>Recuperar contraseña</p> },
        ],
      },
    ],
    { initialEntries: [initialPath] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** Espera a que termine la consulta de /api/setup antes de comprobar lo que no se muestra. */
const settle = () => act(async () => {});

beforeEach(() => useSessionStore.setState({ setup: null, user: USER, userChecked: true }));
afterEach(() => vi.unstubAllGlobals());

describe('indicador del modo mock en el header (RF-184, RF-209)', () => {
  it('AC-195: con MOCK_MODE=true, el header muestra el indicador en cualquier pantalla', async () => {
    mockSetup('mock');
    const router = renderApp('/');
    expect(await screen.findByText(MOCK_INDICATOR)).toBeTruthy();

    await act(async () => {
      await router.navigate('/clientes');
    });
    expect(screen.getByText('Pantalla de clientes')).toBeTruthy();
    expect(screen.getByText(MOCK_INDICATOR)).toBeTruthy();
  });

  it('AC-195: fuera del modo mock, el indicador no se muestra', async () => {
    mockSetup('homologacion');
    renderApp('/');
    expect(await screen.findByText('Dashboard')).toBeTruthy();
    await settle();
    expect(screen.queryByText(MOCK_INDICATOR)).toBeNull();
  });
});

describe('recuperación de contraseña en el login (RF-199)', () => {
  beforeEach(() => useSessionStore.setState({ user: null }));

  it('AC-202: en modo mock, la pantalla de inicio de sesión no ofrece recuperar la contraseña', async () => {
    mockSetup('mock');
    renderApp('/login');
    expect(await screen.findByRole('button', { name: /ingresar/i })).toBeTruthy();
    await settle();
    expect(screen.queryByRole('link', { name: /olvidaste tu contraseña/i })).toBeNull();
  });

  it('fuera del modo mock, la pantalla de inicio de sesión ofrece recuperar la contraseña', async () => {
    mockSetup('homologacion');
    renderApp('/login');
    await settle();
    expect(await screen.findByRole('link', { name: /olvidaste tu contraseña/i })).toBeTruthy();
  });
});
