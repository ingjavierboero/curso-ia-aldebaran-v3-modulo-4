import { App, ConfigProvider, Segmented, theme as antdTheme } from 'antd';
import esES from 'antd/locale/es_ES';
import dayjs from 'dayjs';
import 'dayjs/locale/es';
import { type ReactNode, useEffect, useLayoutEffect, useState } from 'react';
import { create } from 'zustand';

/** Preferencia de tema elegida por el usuario (RNF-15). */
export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

// Calendarios y fechas de dayjs en español, como el resto de la interfaz.
dayjs.locale('es');

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
 * (styled-components) y para los tests. También configura antd en español y su `App`, que da los
 * mensajes flotantes (`App.useApp().message`).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const resolved = useResolvedTheme();

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolved;
    // Scrollbars, controles nativos y el fondo fuera del layout acompañan al tema.
    document.documentElement.style.colorScheme = resolved;
    document.body.style.background = resolved === 'dark' ? '#000' : '#f5f5f5';
  }, [resolved]);

  return (
    <ConfigProvider
      locale={esES}
      theme={{ algorithm: resolved === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm }}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}

const OPTIONS: Array<{ label: string; value: ThemePreference }> = [
  { label: 'Claro', value: 'light' },
  { label: 'Oscuro', value: 'dark' },
  { label: 'Sistema', value: 'system' },
];

/** Selector de tema: claro, oscuro o el del sistema operativo (RNF-15). `block` ocupa todo el ancho. */
export function ThemeSelector({ block = false }: { block?: boolean }) {
  const preference = useThemeStore((state) => state.preference);
  const setPreference = useThemeStore((state) => state.setPreference);
  return (
    <Segmented<ThemePreference>
      aria-label="Tema"
      size="small"
      block={block}
      options={OPTIONS}
      value={preference}
      onChange={setPreference}
    />
  );
}
