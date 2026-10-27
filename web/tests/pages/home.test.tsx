import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../src/router.tsx';
import { ThemeProvider } from '../../src/theme/theme.tsx';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

/** Simula un server con un usuario con sesión. */
function mockServer() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === '/api/setup'
        ? json({ needsFirstAdmin: false, mode: 'mock', emailRedirectTo: null })
        : json({ id: 1, name: 'Ana', email: 'ana@empresa.com', role: 'admin', status: 'activo' }),
    ),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('Inicio y rutas inexistentes', () => {
  it('una ruta inexistente lleva a Inicio, que saluda al usuario por su nombre', async () => {
    mockServer();
    const router = createMemoryRouter(routes, { initialEntries: ['/no-existe'] });
    render(
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>,
    );
    expect(await screen.findByText('Hola, Ana')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/');
  });
});
