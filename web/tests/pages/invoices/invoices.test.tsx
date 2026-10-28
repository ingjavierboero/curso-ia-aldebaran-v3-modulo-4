import type { BillingStatusDto, InvoiceDetailDto, InvoiceDto, UserDto } from '@api-types';
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

const DETAIL: InvoiceDetailDto = {
  invoice: { ...INVOICE, status: 'pagada' },
  pdfUrl: '/api/invoices/1/pdf',
  items: [
    { description: 'Abono mensual', originalPriceCents: 10_000, originalCurrency: 'USD', amountCents: 20_160_000 },
  ],
  statusChanges: [
    {
      fromStatus: 'pendiente_de_pago',
      toStatus: 'revision_manual',
      reason: 'monto no coincide',
      actor: { type: 'agente', userId: null, userName: null },
      changedAt: '2026-10-20T13:00:00.000Z',
    },
    {
      fromStatus: 'revision_manual',
      toStatus: 'pagada',
      reason: null,
      actor: { type: 'usuario', userId: 4, userName: 'Editora' },
      changedAt: '2026-10-21T10:00:00.000Z',
    },
  ],
  emails: [
    {
      id: 5,
      from: 'pagos@losandes.com',
      subject: 'Pago octubre',
      receivedAt: '2026-10-20T12:55:00.000Z',
      classification: 'si',
      attachments: [
        {
          id: 9,
          filename: 'comprobante.pdf',
          mimeType: 'application/pdf',
          classification: 'si',
          cuit: '30711111111',
          amountCents: 14_000_000,
          error: null,
        },
      ],
    },
  ],
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
    if (url === '/api/invoices' || url.startsWith('/api/invoices?')) return json(invoices);
    if (url === '/api/invoices/1') return json(DETAIL);
    if (url === '/api/clients') return json([{ id: 7, businessName: 'Los Andes SRL' }]);
    if (url === '/api/settings') return json({ billingTime: '11:00' });
    if (url === '/api/billing/current/bill-now') return json(status('en_curso', 'facturación en curso'), 202);
    if (url === '/api/billing/current/cancel') return json(status('cancelado', 'la facturación del mes está cancelada'));
    if (url === '/api/billing/current/reactivate') return json(status('pendiente'));
    if (url === '/api/billing/current' && !init?.method?.match(/POST/)) return json(current);
    if (url === '/api/invoices/1/status') return json({ ...INVOICE, status: 'pagada' });
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

describe('pasar a Pagada desde el listado (RF-147)', () => {
  it('AC-150: un Editor pasa a Pagada una factura Pendiente de pago, enviando el estado que vio', async () => {
    loginAs('editor');
    const fetchMock = mockApi(status('completado', 'facturación del mes ya realizada'));
    renderPage();
    const row = (await screen.findByText('00003-00000001')).closest('tr') as HTMLElement;
    const button = within(row).getByRole('button', { name: 'Pasar a Pagada' });
    await act(async () => {
      fireEvent.click(button);
    });
    const yes = await screen.findByRole('button', { name: 'Sí' });
    await act(async () => {
      fireEvent.click(yes);
    });

    const post = fetchMock.mock.calls.find(([url]) => url === '/api/invoices/1/status');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ to: 'pagada', expectedStatus: 'pendiente_de_pago' });
    expect(await screen.findByText('Factura pasada a Pagada.')).toBeTruthy();
  });

  it('RF-13: un usuario Consulta no ve la acción', async () => {
    loginAs('consulta');
    mockApi(status('completado', 'facturación del mes ya realizada'));
    renderPage();
    const row = (await screen.findByText('00003-00000001')).closest('tr') as HTMLElement;
    expect(within(row).queryByRole('button', { name: 'Pasar a Pagada' })).toBeNull();
  });
});

describe('filtros, detalle y PDF de las facturas (RF-162, RF-168, RF-217)', () => {
  it('AC-169: cada factura tiene el link para descargar su PDF', async () => {
    loginAs('consulta');
    mockApi(status('completado', 'la facturación del mes ya se hizo'));
    renderPage();
    const row = (await screen.findByText('00003-00000001')).closest('tr') as HTMLElement;
    expect(within(row).getByRole('link', { name: 'Descargar PDF' }).getAttribute('href')).toBe('/api/invoices/1/pdf');
  });

  it('AC-175: filtrar por estado y por cliente vuelve a pedir el listado con esos filtros', async () => {
    const fetchMock = mockApi(status('completado', 'la facturación del mes ya se hizo'));
    renderPage();
    await screen.findByText('00003-00000001');

    await chooseOption('Filtrar por estado', 'Pendiente de pago');
    await chooseOption('Filtrar por cliente', 'Los Andes SRL');

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toContain('/api/invoices?status=pendiente_de_pago');
    expect(urls).toContain('/api/invoices?status=pendiente_de_pago&clientId=7');
  });

  it('AC-239: un click en la fila abre el detalle con cuotas, PDF, cambios de estado con su actor y el comprobante', async () => {
    loginAs('consulta');
    mockApi(status('completado', 'la facturación del mes ya se hizo'));
    renderPage();
    const cell = await screen.findByText('00003-00000001');
    await act(async () => {
      fireEvent.click(cell);
    });

    const detail = await screen.findByRole('dialog');
    expect(within(detail).getByText('Abono mensual (US$ 100,00)')).toBeTruthy();
    const pdf = within(detail).getByRole('link', { name: /descargar pdf/i });
    expect(pdf.getAttribute('href')).toBe('/api/invoices/1/pdf');
    const changes = within(within(detail).getByRole('list', { name: 'Cambios de estado' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '');
    expect(changes[0]).toMatch(/20\/10\/2026 10:00.*Pendiente de pago → Revisión manual.*monto no coincide.*Agente/);
    expect(changes[1]).toMatch(/21\/10\/2026 07:00.*Revisión manual → Pagada.*Editora/);
    const attachment = within(detail).getByRole('link', { name: 'comprobante.pdf' });
    expect(attachment.getAttribute('href')).toBe('/api/attachments/9');
    expect(within(detail).getByText(/30-71111111-1/)).toBeTruthy();
  });
});

/** Elige una opción de un Select de antd por su etiqueta accesible. */
async function chooseOption(label: string, option: string) {
  await act(async () => {
    fireEvent.mouseDown(screen.getByRole('combobox', { name: label }));
  });
  const item = await screen.findByTitle(option);
  await act(async () => {
    fireEvent.click(item);
  });
}
