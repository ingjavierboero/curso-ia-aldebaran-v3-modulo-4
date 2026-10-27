import type { ProductDto, UserDto } from '@api-types';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductsPage } from '../../../src/pages/products/ProductsPage.tsx';
import { useSessionStore } from '../../../src/stores/session.ts';
import { ThemeProvider } from '../../../src/theme/theme.tsx';

const PRODUCTS: ProductDto[] = [
  { id: 1, name: 'Abono', priceCents: 1_500_000, currency: 'ARS', status: 'activo' },
  { id: 2, name: 'Soporte', priceCents: 12_050, currency: 'USD', status: 'inactivo' },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function mockApi() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && url === '/api/products') return json({ ...PRODUCTS[0], id: 3 }, 201);
    if (init?.method === 'PATCH') return json(PRODUCTS[0]);
    if (init?.method === 'POST') return json({ ...PRODUCTS[0], status: 'inactivo' });
    return json(PRODUCTS);
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

function renderPage() {
  render(
    <ThemeProvider>
      <ProductsPage />
    </ThemeProvider>,
  );
}

const bodyOf = (fetchMock: ReturnType<typeof mockApi>, method: string) =>
  JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === method)?.[1]?.body));

beforeEach(() => loginAs('editor'));
afterEach(() => vi.unstubAllGlobals());

describe('listado de productos (RF-159)', () => {
  it('muestra cada producto con su cuota mensual en su moneda y su estado', async () => {
    mockApi();
    renderPage();
    const abono = (await screen.findByText('Abono')).closest('tr') as HTMLElement;
    expect(within(abono).getByText(/\$\s15\.000,00/)).toBeTruthy();
    expect(within(abono).getByText('Pesos')).toBeTruthy();
    expect(within(abono).getByText('Activo')).toBeTruthy();
    const soporte = screen.getByText('Soporte').closest('tr') as HTMLElement;
    expect(within(soporte).getByText(/US\$\s120,50/)).toBeTruthy();
    expect(within(soporte).getByText('Dólares')).toBeTruthy();
    expect(within(soporte).getByText('Inactivo')).toBeTruthy();
  });

  it('filtra por estado y busca por nombre', async () => {
    mockApi();
    renderPage();
    await screen.findByText('Abono');

    fireEvent.click(screen.getByText('Activos'));
    expect(screen.getByText('Abono')).toBeTruthy();
    expect(screen.queryByText('Soporte')).toBeNull();

    fireEvent.click(screen.getByText('Todos'));
    fireEvent.change(screen.getByPlaceholderText('Buscar por nombre'), { target: { value: 'sop' } });
    expect(screen.queryByText('Abono')).toBeNull();
    expect(screen.getByText('Soporte')).toBeTruthy();
  });

  it('RF-13: un usuario Consulta no ve el botón de alta ni las acciones', async () => {
    loginAs('consulta');
    mockApi();
    renderPage();
    await screen.findByText('Abono');
    expect(screen.queryByRole('button', { name: /nuevo producto/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Modificar' })).toBeNull();
  });
});

describe('alta, modificación y desactivación (RF-42 a RF-48)', () => {
  it('AC-43: el alta envía el precio en centavos y la moneda, y avisa con un mensaje flotante', async () => {
    const fetchMock = mockApi();
    renderPage();
    await screen.findByText('Abono');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /nuevo producto/i }));
    });
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Hosting' } });
    fireEvent.click(within(dialog).getByText('Dólares'));
    fireEvent.change(within(dialog).getByLabelText('Cuota mensual'), { target: { value: '150,50' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /guardar/i }));
    });

    expect(await screen.findByText('Producto dado de alta.')).toBeTruthy();
    expect(bodyOf(fetchMock, 'POST')).toEqual({ name: 'Hosting', priceCents: 15_050, currency: 'USD' });
  });

  it('AC-44: un precio de 0 se rechaza en el formulario sin enviarlo', async () => {
    const fetchMock = mockApi();
    renderPage();
    await screen.findByText('Abono');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /nuevo producto/i }));
    });
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Gratis' } });
    fireEvent.change(within(dialog).getByLabelText('Cuota mensual'), { target: { value: '0' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /guardar/i }));
    });

    expect(await within(dialog).findByText('La cuota mensual debe ser mayor a cero.')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('RF-45, RF-46: la modificación muestra los datos actuales con el precio en pesos', async () => {
    mockApi();
    renderPage();
    const row = (await screen.findByText('Abono')).closest('tr') as HTMLElement;

    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'Modificar' }));
    });
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText('Nombre') as HTMLInputElement).value).toBe('Abono');
    expect((within(dialog).getByLabelText('Cuota mensual') as HTMLInputElement).value).toBe('15.000,00');
  });

  it('AC-47: desactivar un producto pide confirmación y avisa con un mensaje flotante', async () => {
    const fetchMock = mockApi();
    renderPage();
    const row = (await screen.findByText('Abono')).closest('tr') as HTMLElement;

    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'Desactivar' }));
    });
    const confirm = await screen.findByRole('button', { name: 'Sí' });
    await act(async () => {
      fireEvent.click(confirm);
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/products/1/deactivate', expect.objectContaining({ method: 'POST' }));
    expect(await screen.findByText('Producto desactivado.')).toBeTruthy();
  });
});
