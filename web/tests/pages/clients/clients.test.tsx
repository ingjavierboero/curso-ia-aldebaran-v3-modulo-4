import type { ClientEventDto, ClientListItemDto, ProductDto, UserDto } from '@api-types';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientDetailPage } from '../../../src/pages/clients/ClientDetailPage.tsx';
import { ClientsPage } from '../../../src/pages/clients/ClientsPage.tsx';
import { useSessionStore } from '../../../src/stores/session.ts';
import { ThemeProvider } from '../../../src/theme/theme.tsx';

const CLIENTS: ClientListItemDto[] = [
  {
    id: 1,
    businessName: 'Los Andes SRL',
    cuit: '30711111111',
    address: 'Av. Corrientes 1234, CABA',
    billingEmail: 'pagos@losandes.com',
    ivaCondition: 1,
    status: 'activo',
    createdAt: '2026-10-20T12:00:00Z',
    debtCents: 2_200_000,
  },
  {
    id: 2,
    businessName: 'Baja SA',
    cuit: '20111111112',
    address: 'Calle 1',
    billingEmail: 'baja@cliente.com',
    ivaCondition: null,
    status: 'inactivo',
    createdAt: '2026-10-01T12:00:00Z',
    debtCents: 0,
  },
];

const ABONO: ProductDto = { id: 10, name: 'Abono', priceCents: 1_500_000, currency: 'ARS', status: 'activo' };
const SOPORTE: ProductDto = { id: 11, name: 'Soporte', priceCents: 12_050, currency: 'USD', status: 'activo' };
const VIEJO: ProductDto = { id: 12, name: 'Viejo', priceCents: 100, currency: 'ARS', status: 'inactivo' };

const agent = { type: 'agente' as const, userId: null, userName: null };
const user = (userName: string) => ({ type: 'usuario' as const, userId: 5, userName });
const HISTORY: ClientEventDto[] = [
  { id: 1, type: 'alta', occurredAt: '2026-10-20T12:00:00.000Z', actor: user('Editora'), payload: {} },
  {
    id: 2,
    type: 'factura_generada',
    occurredAt: '2026-10-20T12:15:00.000Z',
    actor: agent,
    payload: { voucherNumber: '00003-00000001', period: '2026-10' },
  },
  {
    id: 3,
    type: 'email_enviado',
    occurredAt: '2026-10-20T17:30:00.000Z',
    actor: user('Consultor'),
    payload: { kind: 'recordatorio', trigger: 'manual', to: 'pagos@losandes.com' },
  },
  {
    id: 4,
    type: 'estado_factura',
    occurredAt: '2026-10-21T12:00:00.000Z',
    actor: agent,
    payload: { from: 'pendiente_de_pago', to: 'revision_manual', reason: 'monto no coincide' },
  },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Simula la API de clientes y productos; `assigned` son los productos asignados al cliente 1. */
function mockApi(assigned: ProductDto[] = [ABONO]) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/clients') return json(CLIENTS);
    if (url === '/api/clients/1') return json(CLIENTS[0]);
    if (url === '/api/products') return json([ABONO, SOPORTE, VIEJO]);
    if (url === '/api/clients/1/products' && init?.method === 'PUT') {
      const { productIds } = JSON.parse(String(init.body)) as { productIds: number[] };
      return json([ABONO, SOPORTE, VIEJO].filter((p) => productIds.includes(p.id)));
    }
    if (url === '/api/clients/1/products') return json(assigned);
    if (url === '/api/clients/1/history') return json(HISTORY);
    return json({ error: { code: 'no_encontrado', message: 'No existe.' } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function loginAs(role: UserDto['role']) {
  useSessionStore.setState({
    user: { id: 99, name: 'Usuario', email: 'u@empresa.com', role, status: 'activo' },
    userChecked: true,
  });
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/clientes', element: <ClientsPage /> },
      { path: '/clientes/:id', element: <ClientDetailPage /> },
    ],
    { initialEntries: [path] },
  );
  render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  return router;
}

beforeEach(() => loginAs('editor'));
afterEach(() => vi.unstubAllGlobals());

describe('listado de clientes (RF-158, RF-169)', () => {
  it('muestra cada cliente con su CUIT con guiones, su condición frente al IVA y su estado', async () => {
    mockApi();
    renderAt('/clientes');
    const row = (await screen.findByText('Los Andes SRL')).closest('tr') as HTMLElement;
    expect(within(row).getByText('30-71111111-1')).toBeTruthy();
    expect(within(row).getByText('pagos@losandes.com')).toBeTruthy();
    expect(within(row).getByText('IVA Responsable Inscripto')).toBeTruthy();
    expect(within(row).getByText('Activo')).toBeTruthy();
    // Un cliente heredado sin condición frente al IVA la muestra como faltante (RF-82).
    const legacy = screen.getByText('Baja SA').closest('tr') as HTMLElement;
    expect(within(legacy).getByText('Sin cargar')).toBeTruthy();
  });

  it('filtra por estado y busca por razón social o CUIT', async () => {
    mockApi();
    renderAt('/clientes');
    await screen.findByText('Los Andes SRL');

    fireEvent.click(screen.getByText('Inactivos'));
    expect(screen.queryByText('Los Andes SRL')).toBeNull();
    expect(screen.getByText('Baja SA')).toBeTruthy();

    fireEvent.click(screen.getByText('Todos'));
    const search = screen.getByPlaceholderText('Buscar por razón social o CUIT');
    fireEvent.change(search, { target: { value: '30-7111' } });
    expect(screen.getByText('Los Andes SRL')).toBeTruthy();
    expect(screen.queryByText('Baja SA')).toBeNull();

    fireEvent.change(search, { target: { value: 'baja' } });
    expect(screen.queryByText('Los Andes SRL')).toBeNull();
    expect(screen.getByText('Baja SA')).toBeTruthy();
  });

  it('un click en la fila abre el detalle del cliente', async () => {
    mockApi();
    const router = renderAt('/clientes');
    const name = await screen.findByText('Los Andes SRL');
    await act(async () => {
      fireEvent.click(name);
    });
    expect(router.state.location.pathname).toBe('/clientes/1');
  });

  it('RF-13: un usuario Consulta no ve el botón de alta ni las acciones', async () => {
    loginAs('consulta');
    mockApi();
    renderAt('/clientes');
    await screen.findByText('Los Andes SRL');
    expect(screen.queryByRole('button', { name: /nuevo cliente/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Modificar' })).toBeNull();
  });

  it('el alta envía los datos del formulario y avisa con un mensaje flotante', async () => {
    const fetchMock = mockApi();
    fetchMock.mockImplementationOnce(async () => json(CLIENTS));
    renderAt('/clientes');
    await screen.findByText('Los Andes SRL');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /nuevo cliente/i }));
    });
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Razón social'), { target: { value: 'Nuevo SA' } });
    fireEvent.change(within(dialog).getByLabelText('CUIT'), { target: { value: '20-22222222-3' } });
    fireEvent.change(within(dialog).getByLabelText('Domicilio'), { target: { value: 'Calle 2' } });
    fireEvent.change(within(dialog).getByLabelText('Email de facturación'), { target: { value: 'nuevo@cliente.com' } });
    fetchMock.mockImplementationOnce(async () => json({ ...CLIENTS[0], id: 3, businessName: 'Nuevo SA' }, 201));
    // La condición frente al IVA se elige del selector.
    fireEvent.mouseDown(within(dialog).getByLabelText('Condición frente al IVA'));
    fireEvent.click(await screen.findByTitle('Consumidor Final'));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /guardar/i }));
    });

    expect(await screen.findByText('Cliente dado de alta.')).toBeTruthy();
    const post = fetchMock.mock.calls.find(([url, init]) => url === '/api/clients' && init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      businessName: 'Nuevo SA',
      cuit: '20-22222222-3',
      address: 'Calle 2',
      billingEmail: 'nuevo@cliente.com',
      ivaCondition: 5,
    });
  });
});

describe('detalle del cliente (RF-214) y asignación de productos (RF-49, RF-50)', () => {
  it('muestra los datos del cliente y sus productos asignados con el precio en su moneda', async () => {
    mockApi();
    renderAt('/clientes/1');
    expect(await screen.findByRole('heading', { name: 'Los Andes SRL' })).toBeTruthy();
    expect(screen.getByText('Av. Corrientes 1234, CABA')).toBeTruthy();
    expect(screen.getByText('20/10/2026')).toBeTruthy();
    const row = (await screen.findByText('Abono')).closest('tr') as HTMLElement;
    expect(within(row).getByText(/15\.000,00/)).toBeTruthy();
  });

  it('asigna productos Activos que todavía no tiene: el selector no ofrece los Inactivos ni los ya asignados', async () => {
    const fetchMock = mockApi();
    renderAt('/clientes/1');
    await screen.findByText('Abono');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /asignar productos/i }));
    });
    const dialog = await screen.findByRole('dialog');
    fireEvent.mouseDown(within(dialog).getByRole('combobox'));
    expect(screen.queryByTitle('Viejo')).toBeNull();
    expect(screen.queryByTitle('Abono')).toBeNull();
    fireEvent.click(await screen.findByTitle('Soporte'));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /asignar/i }));
    });

    const put = fetchMock.mock.calls.find(([url, init]) => url === '/api/clients/1/products' && init?.method === 'PUT');
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ productIds: [10, 11] });
    expect(await screen.findByText('Productos asignados.')).toBeTruthy();
  });

  it('desasigna un producto después de confirmar', async () => {
    const fetchMock = mockApi([ABONO, SOPORTE]);
    renderAt('/clientes/1');
    const row = (await screen.findByText('Soporte')).closest('tr') as HTMLElement;

    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'Desasignar' }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Sí' }));
    });

    const put = fetchMock.mock.calls.find(([url, init]) => url === '/api/clients/1/products' && init?.method === 'PUT');
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ productIds: [10] });
    expect(await screen.findByText('Producto desasignado.')).toBeTruthy();
  });

  it('RF-13: un usuario Consulta ve el detalle sin poder modificar ni asignar', async () => {
    loginAs('consulta');
    mockApi();
    renderAt('/clientes/1');
    await screen.findByText('Abono');
    expect(screen.queryByRole('button', { name: /asignar productos/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Desasignar' })).toBeNull();
    expect(screen.queryByRole('button', { name: /modificar/i })).toBeNull();
  });
});

describe('deuda e historial del cliente (RF-158, RF-163)', () => {
  it('AC-165: el listado muestra la deuda vigente de cada cliente', async () => {
    mockApi();
    renderAt('/clientes');
    const andes = (await screen.findByText('Los Andes SRL')).closest('tr') as HTMLElement;
    expect(within(andes).getByText('$ 22.000,00')).toBeTruthy();
    const baja = screen.getByText('Baja SA').closest('tr') as HTMLElement;
    expect(within(baja).getByText('$ 0,00')).toBeTruthy();
  });

  it('AC-170, AC-12: el detalle muestra el historial en orden, con fecha y hora, qué pasó y quién lo hizo', async () => {
    loginAs('consulta');
    mockApi();
    renderAt('/clientes/1');

    const timeline = await screen.findByRole('list', { name: 'Historial del cliente' });
    const items = within(timeline).getAllByRole('listitem').map((item) => item.textContent ?? '');
    expect(items).toHaveLength(4);
    expect(items[0]).toMatch(/20\/10\/2026 09:00.*Alta del cliente.*Editora/);
    expect(items[1]).toMatch(/Factura generada.*00003-00000001.*Agente/);
    expect(items[2]).toMatch(/Recordatorio manual enviado.*pagos@losandes\.com.*Consultor/);
    expect(items[3]).toMatch(/Pendiente de pago → Revisión manual.*monto no coincide.*Agente/);
  });
});
