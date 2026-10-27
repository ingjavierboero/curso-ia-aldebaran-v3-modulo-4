import type { BillingStatusDto, InvoiceDto, UserDto } from '@api-types';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvoicesPage } from '../../../src/pages/invoices/InvoicesPage.tsx';
import { useSessionStore } from '../../../src/stores/session.ts';
import { ThemeProvider } from '../../../src/theme/theme.tsx';

const INVOICE: InvoiceDto = {
  id: 1,
  clientId: 7,
  clientName: 'Los Andes SRL',
  period: '2026-10',
  pointOfSale: 3,
  number: 1,
  voucherNumber: '00003-00000001',
  issueDate: '2026-10-15',
  dueDate: '2026-10-31',
  totalCents: 20_160_000,
  status: 'pendiente_de_pago',
  cae: '70000000000001',
};

const status = (s: BillingStatusDto['status'], reason: string | null = null): BillingStatusDto => ({
  period: '2026-10',
  status: s,
  billNow: { enabled: reason === null, reason },
});

const json = (body: unknown, code = 200) =>
  new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json' } });

/** Simula la API de facturación; `current` es el estado del período en curso. */
function mockApi(current: BillingStatusDto, invoices: InvoiceDto[] = [INVOICE]) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/invoices') return json(invoices);
    if (url === '/api/settings') return json({ billingTime: '11:00' });
    if (url === '/api/billing/current/bill-now') return json(status('en_curso', 'facturación en curso'), 202);
    if (url === '/api/billing/current/cancel') return json(status('cancelado', 'la facturación del mes está cancelada'));
    if (url === '/api/billing/current/reactivate') return json(status('pendiente'));
    if (url === '/api/billing/current' && !init?.method?.match(/POST/)) return json(current);
    return json({ error: { code: 'no_encontrado', message: 'No existe.' } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function loginAs(role: UserDto['role']) {
  useSessionStore.setState({
    user: { id: 9, name: 'Usuario', email: 'u@empresa.com', role, status: 'activo' },
    userChecked: true,
  });
}

function renderPage() {
  render(
    <ThemeProvider>
      <InvoicesPage />
    </ThemeProvider>,
  );
}

const posted = (fetchMock: ReturnType<typeof mockApi>, url: string) =>
  fetchMock.mock.calls.some(([u, init]) => u === url && init?.method === 'POST');

beforeEach(() => loginAs('admin'));
afterEach(() => vi.unstubAllGlobals());

describe('listado de facturas (RF-160)', () => {
  it('muestra cada factura con su número, cliente, período, vencimiento, total y estado', async () => {
    mockApi(status('completado', 'facturación del mes ya realizada'));
    renderPage();
    const row = (await screen.findByText('00003-00000001')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Los Andes SRL')).toBeTruthy();
    expect(within(row).getByText('Octubre 2026')).toBeTruthy();
    expect(within(row).getByText('31/10/2026')).toBeTruthy();
    expect(within(row).getByText(/\$\s201\.600,00/)).toBeTruthy();
    expect(within(row).getByText('Pendiente de pago')).toBeTruthy();
  });

  it('sin facturas lo indica', async () => {
    mockApi(status('pendiente'), []);
    renderPage();
    expect(await screen.findByText('Todavía no hay facturas.')).toBeTruthy();
  });
});

describe('facturación del mes (RF-54 a RF-61)', () => {
  it('RF-58: un Admin ejecuta "Facturar ahora" después de confirmar', async () => {
    const fetchMock = mockApi(status('pendiente'));
    renderPage();
    const button = await screen.findByRole('button', { name: /facturar ahora/i });
    expect((button as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      fireEvent.click(button);
    });
    const confirm = await screen.findByRole('button', { name: 'Facturar' });
    await act(async () => {
      fireEvent.click(confirm);
    });

    expect(posted(fetchMock, '/api/billing/current/bill-now')).toBe(true);
    expect(await screen.findByText('Facturación iniciada.')).toBeTruthy();
  });

  it('AC-60: con la facturación ya realizada, el botón está deshabilitado y muestra el motivo', async () => {
    mockApi(status('completado', 'facturación del mes ya realizada'));
    renderPage();
    const button = await screen.findByRole('button', { name: /facturar ahora/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/facturación del mes ya realizada/i)).toBeTruthy();
  });

  it('RF-54, RF-56: un Admin cancela el mes y después lo reactiva', async () => {
    const fetchMock = mockApi(status('pendiente'));
    renderPage();
    const cancel = await screen.findByRole('button', { name: /cancelar el mes/i });
    await act(async () => {
      fireEvent.click(cancel);
    });
    const confirm = await screen.findByRole('button', { name: /sí, cancelar/i });
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(posted(fetchMock, '/api/billing/current/cancel')).toBe(true);

    const reactivate = await screen.findByRole('button', { name: /reactivar el mes/i });
    await act(async () => {
      fireEvent.click(reactivate);
    });
    expect(posted(fetchMock, '/api/billing/current/reactivate')).toBe(true);
  });

  it('AC-216: un Editor ve el estado del mes pero no las acciones', async () => {
    loginAs('editor');
    mockApi(status('pendiente'));
    renderPage();
    expect(await screen.findByText(/Facturación de octubre de 2026/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /facturar ahora/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /cancelar el mes/i })).toBeNull();
  });
});
