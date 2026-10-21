import { act, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResetPasswordPage } from '../../src/pages/ResetPasswordPage.tsx';

type Reply = { status: number; body?: unknown };

const json = ({ status, body }: Reply) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const INVALID: Reply = { status: 400, body: { error: { code: 'token_invalido', message: 'El link no es válido.' } } };

/** Simula la API: responde a la validación (GET) y a la confirmación (POST) del token. */
function mockApi(check: Reply, confirm: Reply = { status: 204 }) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => json(init?.method === 'POST' ? confirm : check));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage(token = 'token-de-prueba') {
  const router = createMemoryRouter(
    [
      { path: '/restablecer-contrasena/:token', element: <ResetPasswordPage /> },
      { path: '/login', element: <p>Pantalla de inicio de sesión</p> },
    ],
    { initialEntries: [`/restablecer-contrasena/${token}`] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const onLogin = () => screen.queryByText('Pantalla de inicio de sesión') !== null;

async function submitNewPassword(password: string) {
  fireEvent.change(await screen.findByLabelText('Nueva contraseña'), { target: { value: password } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /cambiar contraseña/i }));
  });
}

beforeEach(() => {
  // El reloj falso avanza también con el tiempo real, para que las esperas de Testing Library funcionen.
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('pantalla de cambio de contraseña con token (RF-29 a RF-33)', () => {
  it('RF-32: con un token válido muestra el formulario para la nueva contraseña', async () => {
    const fetchMock = mockApi({ status: 200, body: { valid: true } });
    renderPage('abc123');
    expect(await screen.findByLabelText('Nueva contraseña')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/recovery/abc123', expect.objectContaining({ method: 'GET' }));
  });

  it('AC-29, AC-30: con un token vencido o usado muestra un error y a los 5 s (±1 s) redirige al inicio de sesión', async () => {
    mockApi(INVALID);
    renderPage();
    expect(await screen.findByText(/no es válido o venció/i)).toBeTruthy();
    expect(screen.queryByLabelText('Nueva contraseña')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(onLogin()).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(onLogin()).toBe(true);
  });

  it('AC-32: si el token vence antes de confirmar, muestra un error y a los 5 s (±1 s) redirige al inicio de sesión', async () => {
    mockApi({ status: 200, body: { valid: true } }, INVALID);
    renderPage();
    await submitNewPassword('clave-nueva-123');
    expect(await screen.findByText(/no es válido o venció/i)).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(onLogin()).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(onLogin()).toBe(true);
  });

  it('AC-33, RF-33: al confirmar con un token válido, cambia la contraseña y redirige al inicio de sesión', async () => {
    const fetchMock = mockApi({ status: 200, body: { valid: true } }, { status: 204 });
    renderPage('abc123');
    await submitNewPassword('clave-nueva-123');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/recovery/abc123',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ newPassword: 'clave-nueva-123' }) }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onLogin()).toBe(true);
  });

  it('AC-25: una contraseña de menos de 8 caracteres se rechaza sin enviarla y sin redirigir', async () => {
    const fetchMock = mockApi({ status: 200, body: { valid: true } });
    renderPage();
    await submitNewPassword('1234567');

    expect(await screen.findByText(/al menos 8 caracteres/i)).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(onLogin()).toBe(false);
  });
});
