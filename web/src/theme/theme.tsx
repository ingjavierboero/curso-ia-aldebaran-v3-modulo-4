import { ConfigProvider, Segmented, theme as antdTheme } from 'antd';
import { type ReactNode, useEffect, useLayoutEffect, useState } from 'react';
import { create } from 'zustand';

/** Preferencia de tema elegida por el usuario (RNF-15). */
export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'aldebaran-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function readStoredPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  } catch {
    return 'system';
  }
}

interface ThemeState {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

/** La elección se recuerda en el navegador (localStorage), así sobrevive a recargas y nuevos inicios de sesión. */
export const useThemeStore = create<ThemeState>((set) => ({
  preference: readStoredPreference(),
  setPreference: (preference) => {
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Sin localStorage (por ejemplo, modo privado estricto) el tema vale solo para esta visita.
    }
    set({ preference });
  },
}));

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

/** Tema efectivo: el elegido o, con "Sistema", el del sistema operativo (y sus cambios). */
export function useResolvedTheme(): ResolvedTheme {
  const preference = useThemeStore((state) => state.preference);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);

  if (preference === 'system') return systemDark ? 'dark' : 'light';
  return preference;
}

/**
 * Aplica el tema a antd y lo publica en `<html data-theme="light|dark">`, para los estilos propios
 * (styled-components) y para los tests.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const resolved = useResolvedTheme();

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  return (
    <ConfigProvider
      theme={{ algorithm: resolved === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm }}
    >
      {children}
    </ConfigProvider>
  );
}

const OPTIONS: Array<{ label: string; value: ThemePreference }> = [
  { label: 'Claro', value: 'light' },
  { label: 'Oscuro', value: 'dark' },
  { label: 'Sistema', value: 'system' },
];

/** Selector del header: claro, oscuro o el del sistema operativo (RNF-15). */
export function ThemeSelector() {
  const preference = useThemeStore((state) => state.preference);
  const setPreference = useThemeStore((state) => state.setPreference);
  return (
    <Segmented<ThemePreference>
      aria-label="Tema"
      size="small"
      options={OPTIONS}
      value={preference}
      onChange={setPreference}
    />
  );
}
