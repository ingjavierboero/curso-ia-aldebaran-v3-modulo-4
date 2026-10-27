import type { UserDto } from '@api-types';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserMenu } from '../../src/components/UserMenu.tsx';
import { useThemeStore } from '../../src/theme/theme.tsx';

const USER: UserDto = { id: 1, name: 'Ana María Pérez', email: 'ana@empresa.com', role: 'editor', status: 'activo' };

function renderMenu() {
  const router = createMemoryRouter(
    [
      { path: '/', element: <UserMenu user={USER} /> },
      { path: '/perfil', element: <p>Pantalla de perfil</p> },
      { path: '/login', element: <p>Pantalla de inicio de sesión</p> },
    ],
    { initialEntries: ['/'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const openMenu = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Ana María Pérez/ }));
  });
};

afterEach(() => vi.unstubAllGlobals());

describe('menú del usuario en el header', () => {
  it('muestra las iniciales, el nombre y el perfil del usuario', () => {
    renderMenu();
    expect(screen.getByText('AM')).toBeTruthy();
    expect(screen.getByText('Ana María Pérez')).toBeTruthy();
    expect(screen.getByText('Editor')).toBeTruthy();
  });

  it('RNF-15: al abrirlo muestra el email y el selector de tema, que cambia el tema elegido', async () => {
    renderMenu();
    await openMenu();
    expect(await screen.findByText('ana@empresa.com')).toBeTruthy();

    fireEvent.click(screen.getByText('Oscuro'));
    expect(useThemeStore.getState().preference).toBe('dark');
  });

  it('"Mi perfil" lleva a la pantalla de perfil', async () => {
    const router = renderMenu();
    await openMenu();
    await act(async () => {
      fireEvent.click(await screen.findByText('Mi perfil'));
    });
    expect(router.state.location.pathname).toBe('/perfil');
  });

  it('"Cerrar sesión" cierra la sesión y lleva al inicio de sesión', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const router = renderMenu();
    await openMenu();
    await act(async () => {
      fireEvent.click(await screen.findByText('Cerrar sesión'));
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }));
    expect(router.state.location.pathname).toBe('/login');
  });
});
