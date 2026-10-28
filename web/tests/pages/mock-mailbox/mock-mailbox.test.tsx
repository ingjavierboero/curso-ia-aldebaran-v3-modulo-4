import type { MockEmailDto, UserDto } from '@api-types';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockMailboxPage } from '../../../src/pages/mock-mailbox/MockMailboxPage.tsx';
import { useSessionStore } from '../../../src/stores/session.ts';
import { ThemeProvider } from '../../../src/theme/theme.tsx';

const SENT: MockEmailDto = {
  id: 1,
  direction: 'enviado',
  messageId: '<a@aldebaran-mock>',
  from: 'aldebaran-mock@gmail.com',
  fromName: 'Estudio Molina',
  to: 'pagos@losandes.com',
  subject: 'Factura C 0003-00000001 - Octubre 2026',
  body: 'Te enviamos la Factura C 0003-00000001.',
  createdAt: '2026-10-15T14:00:00.000Z',
  attachments: [{ id: 4, filename: 'factura-C-0003-00000001.pdf', mimeType: 'application/pdf' }],
};

const RECEIVED: MockEmailDto = {
  id: 2,
  direction: 'recibido',
  messageId: '<b@aldebaran-mock>',
  from: 'pagos@losandes.com',
  fromName: null,
  to: 'aldebaran-mock@gmail.com',
  subject: 'Pago de octubre',
  body: 'Adjunto el comprobante.',
  createdAt: '2026-10-20T13:00:00.000Z',
  attachments: [],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** API de la casilla simulada y de clientes (para sugerir remitentes). */
function mockApi(emails: MockEmailDto[]) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/mock-mailbox/received' && init?.method === 'POST') return json(RECEIVED, 201);
    if (url === '/api/mock-mailbox') return json(emails);
    if (url === '/api/clients') return json([]);
    return json([]);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function loginAs(role: UserDto['role']) {
  useSessionStore.setState({
    user: { id: 9, name: 'Ana', email: 'ana@empresa.com', role, status: 'activo' },
    userChecked: true,
  });
}

function renderPage() {
  const router = createMemoryRouter([{ path: '/casilla-simulada', element: <MockMailboxPage /> }], {
    initialEntries: ['/casilla-simulada'],
  });
  render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
}

beforeEach(() => loginAs('admin'));
afterEach(() => vi.unstubAllGlobals());

describe('casilla simulada en la web (RF-197 a RF-200)', () => {
  it('AC-200: lista los emails con su dirección y, al abrir uno, muestra el cuerpo y los adjuntos', async () => {
    mockApi([RECEIVED, SENT]);
    renderPage();

    const subject = await screen.findByText('Factura C 0003-00000001 - Octubre 2026');
    expect(screen.getByText('Enviado')).toBeTruthy();
    expect(screen.getByText('Recibido')).toBeTruthy();
    expect(screen.getByText('15/10/2026 11:00')).toBeTruthy();

    await act(async () => {
      fireEvent.click(subject);
    });
    expect(await screen.findByText('Te enviamos la Factura C 0003-00000001.')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'factura-C-0003-00000001.pdf' });
    expect(link.getAttribute('href')).toBe('/api/mock-mailbox/1/attachments/4');
  });

  it('AC-203: un Editor carga un email recibido con un adjunto y la casilla se recarga', async () => {
    loginAs('editor');
    const fetchMock = mockApi([]);
    renderPage();

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /cargar email recibido/i }));
    });
    fireEvent.change(screen.getByLabelText('Remitente'), { target: { value: 'pagos@losandes.com' } });
    fireEvent.change(screen.getByLabelText('Asunto'), { target: { value: 'Pago de octubre' } });
    fireEvent.change(screen.getByLabelText('Cuerpo'), { target: { value: 'Adjunto el comprobante.' } });
    const file = new File(['%PDF-1.4'], 'pago_30711111111_15000.50.pdf', { type: 'application/pdf' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    expect(await screen.findByText('pago_30711111111_15000.50.pdf')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^cargar$/i }));
    });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/mock-mailbox/received', expect.objectContaining({ method: 'POST' })),
    );
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/mock-mailbox/received');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      from: 'pagos@losandes.com',
      subject: 'Pago de octubre',
      body: 'Adjunto el comprobante.',
      attachments: [
        { filename: 'pago_30711111111_15000.50.pdf', mimeType: 'application/pdf', contentBase64: btoa('%PDF-1.4') },
      ],
    });
    expect(await screen.findByText(/se procesa en la siguiente revisión de la casilla/i)).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/mock-mailbox')).toHaveLength(2);
  });

  it('AC-219: un usuario Consulta no ve la opción de cargar emails', async () => {
    loginAs('consulta');
    mockApi([RECEIVED]);
    renderPage();
    expect(await screen.findByText('Pago de octubre')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /cargar email recibido/i })).toBeNull();
  });
});
