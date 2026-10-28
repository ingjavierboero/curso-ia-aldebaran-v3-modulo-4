import type { DashboardDto, DebtorDto, UserDto } from '@api-types';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardPage } from '../../src/pages/DashboardPage.tsx';
import { useSessionStore } from '../../src/stores/session.ts';
import { ThemeProvider } from '../../src/theme/theme.tsx';

const debtor = (clientId: number, businessName: string, overrides: Partial<DebtorDto> = {}): DebtorDto => ({
  clientId,
  businessName,
  clientStatus: 'activo',
  debtCents: 1_000_000,
  owedInvoices: 2,
  inReview: false,
  ...overrides,
});

const DEBTORS: DebtorDto[] = [
  debtor(1, 'Los Andes SRL', { debtCents: 2_200_000 }),
  debtor(2, 'Estudio Ríos', { inReview: true }),
  debtor(3, 'Taller Sur', { clientStatus: 'inactivo', debtCents: 300_000, owedInvoices: 1 }),
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Dashboard con esos deudores; el recordatorio responde con `reminderReply`. */
function mockApi(
  debtors: DebtorDto[],
  reminderReply: () => Response = () => json({ status: 'enviado', sentAt: '2026-10-20T13:00:00.000Z' }),
) {
  const dashboard: DashboardDto = { banners: { certificate: null, exchangeRate: null }, debtors };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    url.endsWith('/reminder') && init?.method === 'POST' ? reminderReply() : json(dashboard),
  );
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
  const router = createMemoryRouter([{ path: '/', element: <DashboardPage /> }], { initialEntries: ['/'] });
  render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
}

const rowOf = async (name: string) => (await screen.findByText(name)).closest('tr') as HTMLElement;

/** Envía el recordatorio desde la fila del cliente, confirmando. */
async function sendReminder(name: string) {
  const row = await rowOf(name);
  await act(async () => {
    fireEvent.click(within(row).getByRole('button', { name: 'Enviar recordatorio' }));
  });
  await act(async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Sí' }));
  });
}

beforeEach(() => loginAs('consulta'));
afterEach(() => vi.unstubAllGlobals());

describe('dashboard de deuda (RF-153)', () => {
  it('AC-161: lista los clientes con deuda vigente con su deuda total, facturas adeudadas y si está en revisión', async () => {
    mockApi(DEBTORS);
    renderPage();

    const andes = await rowOf('Los Andes SRL');
    expect(within(andes).getByText('$ 22.000,00')).toBeTruthy();
    expect(within(andes).getByText('2')).toBeTruthy();
    expect(within(await rowOf('Estudio Ríos')).getByText('En revisión')).toBeTruthy();
    expect(within(await rowOf('Taller Sur')).getByText('Inactivo')).toBeTruthy();
    expect(screen.getByText('Hola, Ana')).toBeTruthy();
  });

  it('sin clientes con deuda vigente lo indica', async () => {
    mockApi([]);
    renderPage();
    expect(await screen.findByText('No hay clientes con deuda vigente.')).toBeTruthy();
  });
});

describe('recordatorio manual (RF-154, RF-156, RF-157, RF-96)', () => {
  it('AC-13: un usuario Consulta envía el recordatorio a un cliente Activo con deuda y sin revisión', async () => {
    const fetchMock = mockApi(DEBTORS);
    renderPage();

    await sendReminder('Los Andes SRL');

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/clients/1/reminder', expect.objectContaining({ method: 'POST' })),
    );
    expect(await screen.findByText('Recordatorio enviado a Los Andes SRL.')).toBeTruthy();
  });

  it('AC-164, AC-89: los clientes en revisión o Inactivos no tienen el botón de recordatorio', async () => {
    mockApi(DEBTORS);
    renderPage();
    for (const name of ['Estudio Ríos', 'Taller Sur']) {
      expect(within(await rowOf(name)).queryByRole('button', { name: 'Enviar recordatorio' })).toBeNull();
    }
  });

  it('si la API bloquea el recordatorio, muestra su mensaje', async () => {
    mockApi(DEBTORS, () =>
      json({ error: { code: 'en_revision', message: 'El cliente tiene un pago en revisión manual.' } }, 422),
    );
    renderPage();

    await sendReminder('Los Andes SRL');

    expect(await screen.findByText('El cliente tiene un pago en revisión manual.')).toBeTruthy();
  });
});
