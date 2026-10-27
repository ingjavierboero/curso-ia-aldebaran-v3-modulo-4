import type { UserDto } from '@api-types';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UsersPage } from '../../src/pages/UsersPage.tsx';
import { ThemeProvider } from '../../src/theme/theme.tsx';

const USERS: UserDto[] = [
  { id: 1, name: 'Ana Activa', email: 'ana@empresa.com', role: 'admin', status: 'activo' },
  { id: 2, name: 'Beto Baja', email: 'beto@empresa.com', role: 'editor', status: 'inactivo' },
];

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

function mockApi() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    init?.method === 'POST' ? json({ ...USERS[0], status: 'inactivo' }) : json(USERS),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage() {
  render(
    <ThemeProvider>
      <UsersPage />
    </ThemeProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('pantalla de usuarios (plan.md, Diseño de la interfaz)', () => {
  it('filtra el listado por Todos, Activos o Inactivos', async () => {
    mockApi();
    renderPage();
    expect(await screen.findByText('Ana Activa')).toBeTruthy();
    expect(screen.getByText('Beto Baja')).toBeTruthy();

    fireEvent.click(screen.getByText('Activos'));
    expect(screen.getByText('Ana Activa')).toBeTruthy();
    expect(screen.queryByText('Beto Baja')).toBeNull();

    fireEvent.click(screen.getByText('Inactivos'));
    expect(screen.queryByText('Ana Activa')).toBeNull();
    expect(screen.getByText('Beto Baja')).toBeTruthy();
  });

  it('al dar de baja un usuario lo avisa con un mensaje flotante', async () => {
    const fetchMock = mockApi();
    renderPage();
    const row = (await screen.findByText('Ana Activa')).closest('tr') as HTMLElement;

    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'Dar de baja' }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Sí' }));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/users/1/deactivate', expect.objectContaining({ method: 'POST' }));
    expect(await screen.findByText('Usuario dado de baja.')).toBeTruthy();
  });
});
