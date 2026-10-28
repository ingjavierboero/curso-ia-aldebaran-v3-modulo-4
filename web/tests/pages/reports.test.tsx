import type { BillingReportRow, CollectionsReportRow, DebtReportRow, UserDto } from '@api-types';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportsPage } from '../../src/pages/ReportsPage.tsx';
import { useSessionStore } from '../../src/stores/session.ts';
import { ThemeProvider } from '../../src/theme/theme.tsx';

const BILLING: BillingReportRow[] = [
  { period: '2026-09', invoiceCount: 3, totalCents: 6_000_000 },
  { period: '2026-10', invoiceCount: 2, totalCents: 1_000_000 },
];
const COLLECTIONS: CollectionsReportRow[] = [
  {
    period: '2026-10',
    totalCents: 10_000_000,
    paidCents: 1_000_000,
    paymentReceivedCents: 2_000_000,
    owedCents: 7_000_000,
  },
];
const DEBT: DebtReportRow[] = [
  {
    clientId: 1,
    businessName: 'Los Andes SA',
    debtCents: 2_200_000,
    invoices: [
      {
        invoiceId: 1,
        voucherNumber: '00001-00000001',
        period: '2026-08',
        totalCents: 1_000_000,
        dueDate: '2026-08-31',
        status: 'pendiente_de_pago',
      },
      {
        invoiceId: 2,
        voucherNumber: '00001-00000002',
        period: '2026-09',
        totalCents: 1_200_000,
        dueDate: '2026-09-30',
        status: 'revision_manual',
      },
    ],
  },
];

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

function mockApi() {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith('/api/reports/billing')) return json(BILLING);
    if (url.startsWith('/api/reports/collections')) return json(COLLECTIONS);
    if (url.startsWith('/api/reports/debt')) return json(DEBT);
    return json([]);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage() {
  const router = createMemoryRouter([{ path: '/reportes', element: <ReportsPage /> }], {
    initialEntries: ['/reportes'],
  });
  render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
}

const openTab = async (label: RegExp) => {
  const tab = await screen.findByRole('tab', { name: label });
  await act(async () => {
    fireEvent.click(tab);
  });
};

const rowOf = async (text: string) => (await screen.findByText(text)).closest('tr') as HTMLElement;

beforeEach(() =>
  useSessionStore.setState({
    user: { id: 1, name: 'Ana', email: 'ana@empresa.com', role: 'consulta' as UserDto['role'], status: 'activo' },
    userChecked: true,
  }),
);
afterEach(() => vi.unstubAllGlobals());

describe('reportes (RF-164 a RF-167)', () => {
  it('AC-171: el reporte de facturación muestra cada período con la cantidad de facturas y el total', async () => {
    mockApi();
    renderPage();
    const september = await rowOf('Septiembre 2026');
    expect(within(september).getByText('3')).toBeTruthy();
    expect(within(september).getByText('$ 60.000,00')).toBeTruthy();
    expect(within(await rowOf('Octubre 2026')).getByText('$ 10.000,00')).toBeTruthy();
  });

  it('AC-172: el reporte de cobranza muestra el total, la parte Pagada, en Pago recibido y adeudada', async () => {
    mockApi();
    renderPage();
    await openTab(/cobranza/i);
    const october = await rowOf('Octubre 2026');
    for (const amount of ['$ 100.000,00', '$ 10.000,00', '$ 20.000,00', '$ 70.000,00']) {
      expect(within(october).getByText(amount)).toBeTruthy();
    }
  });

  it('AC-173: el reporte de deuda muestra una fila por factura adeudada con el cliente y su deuda total', async () => {
    mockApi();
    renderPage();
    await openTab(/deuda/i);
    const first = await rowOf('00001-00000001');
    expect(within(first).getByText('Los Andes SA')).toBeTruthy();
    expect(within(first).getByText('$ 22.000,00')).toBeTruthy();
    expect(within(first).getByText('Agosto 2026')).toBeTruthy();
    expect(within(first).getByText('31/08/2026')).toBeTruthy();
    expect(within(first).getByText('Pendiente de pago')).toBeTruthy();
    expect(within(await rowOf('00001-00000002')).getByText('Revisión manual')).toBeTruthy();
  });

  it('AC-174: cada reporte tiene su descarga CSV con los mismos filtros', async () => {
    mockApi();
    renderPage();
    const csvLink = () => screen.getByRole('link', { name: /descargar csv/i }).getAttribute('href');

    await screen.findByText('Septiembre 2026');
    expect(csvLink()).toBe('/api/reports/billing?format=csv');
    await openTab(/cobranza/i);
    await screen.findByText('Octubre 2026');
    expect(csvLink()).toBe('/api/reports/collections?format=csv');
    await openTab(/deuda/i);
    await screen.findByText('00001-00000001');
    expect(csvLink()).toBe('/api/reports/debt?format=csv');
  });
});
