import type { NoticeDto, ResolvedPaymentDto, ReviewPaymentDto, UserDto } from '@api-types';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewPage } from '../../../src/pages/review/ReviewPage.tsx';
import { useSessionStore } from '../../../src/stores/session.ts';
import { ThemeProvider } from '../../../src/theme/theme.tsx';

const payment = (status: 'pago_recibido' | 'revision_manual', reason: string | null = null): ReviewPaymentDto => ({
  invoice: {
    id: 1,
    clientId: 7,
    clientName: 'Los Andes SRL',
    period: '2026-10',
    voucherNumber: '00003-00000001',
    totalCents: 1_000_000,
    dueDate: '2026-10-31',
    status,
    reason,
  },
  emails: [
    {
      id: 5,
      from: 'pagos@losandes.com',
      subject: 'Pago octubre',
      receivedAt: '2026-10-20T13:00:00.000Z',
      classification: 'si',
      attachments: [
        { id: 9, filename: 'comprobante.pdf', mimeType: 'application/pdf', classification: 'si', cuit: '30711111111', amountCents: 1_000_000, error: null },
      ],
    },
  ],
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const CONFLICT = {
  error: {
    code: 'estado_cambiado',
    message: 'La factura cambió de estado mientras la mirabas: ahora está en Revisión manual.',
    details: { currentStatus: 'revision_manual' },
  },
};

/** API de revisión: `payments` devuelve, en orden, las respuestas de cada carga de pagos. */
function mockApi(payments: ReviewPaymentDto[][], statusReply: () => Response) {
  let loads = 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/review/payments') return json(payments[Math.min(loads++, payments.length - 1)]);
    if (url.startsWith('/api/invoices/') && init?.method === 'POST') return statusReply();
    return json([]);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, loads: () => loads };
}

function loginAs(role: UserDto['role']) {
  useSessionStore.setState({
    user: { id: 9, name: 'Editora', email: 'e@empresa.com', role, status: 'activo' },
    userChecked: true,
  });
}

function renderPage() {
  const router = createMemoryRouter([{ path: '/revision', element: <ReviewPage /> }], { initialEntries: ['/revision'] });
  render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
}

/** Confirma una acción de la fila de la factura. */
async function confirmAction(label: string) {
  const row = (await screen.findByText('00003-00000001')).closest('tr') as HTMLElement;
  const button = within(row).getByRole('button', { name: label });
  await act(async () => {
    fireEvent.click(button);
  });
  const yes = await screen.findByRole('button', { name: 'Sí' });
  await act(async () => {
    fireEvent.click(yes);
  });
}

beforeEach(() => loginAs('editor'));
afterEach(() => vi.unstubAllGlobals());

describe('decisiones en la pantalla de revisión', () => {
  it('AC-240, RF-218: ante un 409 muestra el mensaje y recarga la vista con el estado vigente', async () => {
    const api = mockApi([[payment('pago_recibido')], [payment('revision_manual', 'revisión manual pendiente')]], () =>
      json(CONFLICT, 409),
    );
    renderPage();
    const row = (await screen.findByText('00003-00000001')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Pago recibido')).toBeTruthy();

    await confirmAction('Pasar a Pagada');

    expect(await screen.findByText(CONFLICT.error.message)).toBeTruthy();
    await vi.waitFor(() => expect(api.loads()).toBe(2));
    const updated = (await screen.findByText('Revisión manual')).closest('tr') as HTMLElement;
    expect(within(updated).getByText('revisión manual pendiente')).toBeTruthy();
  });

  it('RF-143: al pasar a Pagada envía el estado que vio el usuario y la factura deja la lista', async () => {
    const api = mockApi([[payment('pago_recibido')], []], () => json({ id: 1, status: 'pagada' }));
    renderPage();
    await confirmAction('Pasar a Pagada');

    const post = api.fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(post?.[0]).toBe('/api/invoices/1/status');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ to: 'pagada', expectedStatus: 'pago_recibido' });
    expect(await screen.findByText('Factura pasada a Pagada.')).toBeTruthy();
    await vi.waitFor(() => expect(screen.queryByText('00003-00000001')).toBeNull());
  });

  it('RF-146: devolver a Pendiente de pago envía ese destino', async () => {
    const api = mockApi([[payment('revision_manual', 'monto no coincide')], []], () => json({ id: 1, status: 'pendiente_de_pago' }));
    renderPage();
    await confirmAction('Devolver a Pendiente de pago');
    const post = api.fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ to: 'pendiente_de_pago', expectedStatus: 'revision_manual' });
  });

  it('RF-13: un usuario Consulta ve los pagos sin las acciones', async () => {
    loginAs('consulta');
    mockApi([[payment('pago_recibido')]], () => json({}));
    renderPage();
    const row = (await screen.findByText('00003-00000001')).closest('tr') as HTMLElement;
    expect(within(row).queryByRole('button', { name: 'Pasar a Pagada' })).toBeNull();
  });
});

const NOTICE: NoticeDto = {
  id: 3,
  email: {
    id: 8,
    from: 'otro@desconocido.com',
    subject: 'Transferencia',
    receivedAt: '2026-10-20T13:05:00.000Z',
    classification: null,
    attachments: [
      { id: 11, filename: 'comprobante.pdf', mimeType: 'application/pdf', classification: null, cuit: null, amountCents: null, error: null },
    ],
  },
};

const RESOLVED: ResolvedPaymentDto[] = [
  {
    invoice: { ...payment('revision_manual').invoice, id: 1, status: 'pagada', reason: null },
    decision: 'pagada',
    decidedBy: { id: 9, name: 'Editora' },
    decidedAt: '2026-10-20T15:00:00.000Z',
    previousStatus: 'revision_manual',
    previousReason: 'monto no coincide',
    emails: [],
  },
  {
    invoice: { ...payment('pago_recibido').invoice, id: 2, voucherNumber: '00003-00000002', status: 'pendiente_de_pago', reason: null },
    decision: 'pendiente_de_pago',
    decidedBy: { id: 9, name: 'Editora' },
    decidedAt: '2026-10-20T14:00:00.000Z',
    previousStatus: 'pago_recibido',
    previousReason: null,
    emails: [],
  },
];

/** API con avisos y resueltos; registra cada llamada. */
function mockReviewApi(noticeLists: NoticeDto[][]) {
  let noticeLoads = 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/review/notices') return json(noticeLists[Math.min(noticeLoads++, noticeLists.length - 1)]);
    if (url.startsWith('/api/review/resolved')) return json(RESOLVED);
    if (init?.method === 'POST') return json({ id: 3, status: 'revisado' });
    return json([]);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const openTab = async (label: RegExp) => {
  const tab = await screen.findByRole('tab', { name: label });
  await act(async () => {
    fireEvent.click(tab);
  });
};

describe('avisos y resueltos', () => {
  it('AC-145, AC-153: muestra los avisos con remitente, asunto, fecha y adjunto, y un Editor marca uno como revisado', async () => {
    const fetchMock = mockReviewApi([[NOTICE], []]);
    renderPage();
    await openTab(/avisos/i);

    const row = (await screen.findByText('otro@desconocido.com')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Transferencia')).toBeTruthy();
    expect(within(row).getByText('20/10/2026 10:05')).toBeTruthy();
    expect(within(row).getByRole('link', { name: 'comprobante.pdf' }).getAttribute('href')).toBe('/api/attachments/11');

    const button = within(row).getByRole('button', { name: 'Marcar como revisado' });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/review/notices/3/reviewed', expect.objectContaining({ method: 'POST' }));
    expect(await screen.findByText('Aviso marcado como revisado.')).toBeTruthy();
  });

  it('AC-238: los resueltos muestran la decisión, el usuario, la fecha, el estado y el motivo previos', async () => {
    mockReviewApi([[]]);
    renderPage();
    await openTab(/resueltos/i);

    const paid = (await screen.findByText('00003-00000001')).closest('tr') as HTMLElement;
    expect(within(paid).getByText('Pagada')).toBeTruthy();
    expect(within(paid).getByText('Editora')).toBeTruthy();
    expect(within(paid).getByText('20/10/2026 12:00')).toBeTruthy();
    expect(within(paid).getByText('Revisión manual')).toBeTruthy();
    expect(within(paid).getByText('monto no coincide')).toBeTruthy();
    const returned = screen.getByText('00003-00000002').closest('tr') as HTMLElement;
    expect(within(returned).getByText('Devuelta a Pendiente de pago')).toBeTruthy();
  });
});
