import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Simula la preferencia de tema del sistema operativo. */
function mockSystemTheme(dark: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: dark && query.includes('prefers-color-scheme: dark'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

/** Cada import nuevo del módulo simula recargar la página en el mismo navegador. */
async function loadPage() {
  vi.resetModules();
  const { ThemeProvider, ThemeSelector } = await import('../src/theme/theme.tsx');
  return render(
    <ThemeProvider>
      <ThemeSelector />
    </ThemeProvider>,
  );
}

const currentTheme = () => document.documentElement.dataset.theme;

describe('tema claro y oscuro (RNF-15)', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('AC-235: sin ninguna elección guardada, sigue el tema oscuro del sistema operativo', async () => {
    mockSystemTheme(true);
    await loadPage();
    expect(currentTheme()).toBe('dark');
  });

  it('sin ninguna elección guardada, sigue el tema claro del sistema operativo', async () => {
    mockSystemTheme(false);
    await loadPage();
    expect(currentTheme()).toBe('light');
  });

  it('AC-235: al elegir el tema claro desde el header, la interfaz pasa a tema claro', async () => {
    mockSystemTheme(true);
    await loadPage();
    act(() => {
      fireEvent.click(screen.getByText('Claro'));
    });
    expect(currentTheme()).toBe('light');
  });

  it('AC-235: la elección se recuerda en ese navegador al recargar la página', async () => {
    mockSystemTheme(true);
    const page = await loadPage();
    act(() => {
      fireEvent.click(screen.getByText('Claro'));
    });
    page.unmount();

    await loadPage();
    expect(currentTheme()).toBe('light');
  });

  it('se puede elegir el tema oscuro aunque el sistema operativo use el claro', async () => {
    mockSystemTheme(false);
    await loadPage();
    act(() => {
      fireEvent.click(screen.getByText('Oscuro'));
    });
    expect(currentTheme()).toBe('dark');
  });

  it('elegir "Sistema" vuelve a seguir la preferencia del sistema operativo', async () => {
    mockSystemTheme(false);
    localStorage.setItem('aldebaran-theme', 'dark');
    const page = await loadPage();
    expect(currentTheme()).toBe('dark');

    act(() => {
      fireEvent.click(screen.getByText('Sistema'));
    });
    expect(currentTheme()).toBe('light');

    page.unmount();
    await loadPage();
    expect(currentTheme()).toBe('light');
  });

  it('una elección guardada inválida se ignora y se sigue al sistema operativo', async () => {
    mockSystemTheme(true);
    localStorage.setItem('aldebaran-theme', 'violeta');
    await loadPage();
    expect(currentTheme()).toBe('dark');
  });
});
