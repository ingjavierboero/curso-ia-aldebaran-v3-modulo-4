import type { SettingsDto, UserDto } from '@api-types';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from '../../src/pages/SettingsPage.tsx';
import { useSessionStore } from '../../src/stores/session.ts';
import { ThemeProvider } from '../../src/theme/theme.tsx';

const SETTINGS: SettingsDto = {
  mailboxIntervalMinutes: 15,
  billingTime: '11:00',
  remindersTime: '11:00',
  retryCount: 3,
  retryWaitMinutes: 5,
  pointOfSale: 1,
  issuerBusinessName: 'Javier SRL',
  issuerAddress: 'Rivera 3949',
  issuerIvaCondition: 'Responsable Monotributo',
  issuerGrossIncomeNumber: null,
  issuerActivityStartDate: '2022-10-01',
  issuerTradeName: 'B12 Software',
  issuerCuit: '20111111112',
  missingForBilling: ['número de ingresos brutos'],
};

const MISSING = 'No se pueden generar facturas hasta completar: número de ingresos brutos.';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

function renderAs(role: UserDto['role'], saved: SettingsDto = { ...SETTINGS, missingForBilling: [] }) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => json(init?.method === 'PUT' ? saved : SETTINGS));
  vi.stubGlobal('fetch', fetchMock);
  useSessionStore.setState({
    user: { id: 1, name: 'Ana', email: 'ana@empresa.com', role, status: 'activo' },
    userChecked: true,
  });
  const router = createMemoryRouter([{ path: '/', element: <SettingsPage /> }]);
  render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  return fetchMock;
}

const isMarkedRequired = (label: string) =>
  screen.getByText(label).closest('label')?.classList.contains('ant-form-item-required') ?? false;

afterEach(() => vi.unstubAllGlobals());

describe('datos obligatorios para facturar (RF-219, RF-221)', () => {
  it('AC-257: marca los datos obligatorios y avisa cuáles faltan para generar facturas', async () => {
    renderAs('consulta');

    expect(await screen.findByText(MISSING)).toBeTruthy();
    for (const label of [
      'Razón social',
      'Domicilio comercial',
      'Condición frente al IVA',
      'Número de ingresos brutos',
      'Fecha de inicio de actividades',
      'Punto de venta de ARCA',
    ]) {
      expect(isMarkedRequired(label), label).toBe(true);
    }
    expect(isMarkedRequired('Nombre de fantasía')).toBe(false);
  });

  it('AC-257: cuando un Admin completa el dato y guarda, el aviso deja de mostrarse', async () => {
    const fetchMock = renderAs('admin');
    expect(await screen.findByText(MISSING)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Número de ingresos brutos'), { target: { value: '901-123456-7' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    expect(await screen.findByText('Configuración guardada.')).toBeTruthy();
    expect(screen.queryByText(MISSING)).toBeNull();
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(String(put?.[1]?.body))).toMatchObject({ issuerGrossIncomeNumber: '901-123456-7' });
  });

  it('un Admin puede guardar otros valores aunque falte un dato obligatorio', async () => {
    const fetchMock = renderAs('admin', SETTINGS);
    expect(await screen.findByText(MISSING)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    expect(await screen.findByText('Configuración guardada.')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true);
    expect(screen.getByText(MISSING)).toBeTruthy();
  });

  it('con todos los datos completos no hay aviso', async () => {
    const complete = { ...SETTINGS, issuerGrossIncomeNumber: '1', missingForBilling: [] };
    vi.stubGlobal('fetch', vi.fn(async () => json(complete)));
    useSessionStore.setState({
      user: { id: 1, name: 'Ana', email: 'ana@empresa.com', role: 'admin', status: 'activo' },
      userChecked: true,
    });
    render(
      <ThemeProvider>
        <RouterProvider router={createMemoryRouter([{ path: '/', element: <SettingsPage /> }])} />
      </ThemeProvider>,
    );
    expect(await screen.findByText('Razón social')).toBeTruthy();
    expect(screen.queryByText(/No se pueden generar facturas/)).toBeNull();
  });
});
