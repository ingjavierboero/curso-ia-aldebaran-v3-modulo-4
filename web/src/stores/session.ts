import type { SetupInfo, UserDto } from '@api-types';
import { create } from 'zustand';
import { api, setUnauthorizedHandler } from '../api/client.ts';

interface SessionState {
  /** Estado inicial de la app: primer Admin pendiente, modo y redirección de emails (RF-04, RF-220). */
  setup: SetupInfo | null;
  /** Usuario con sesión abierta, o null si no hay sesión. */
  user: UserDto | null;
  /** true una vez que se consultó si hay sesión, para no redirigir al login antes de saberlo. */
  userChecked: boolean;
  loadSetup: () => Promise<void>;
  loadUser: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useSessionStore = create<SessionState>((set) => ({
  setup: null,
  user: null,
  userChecked: false,

  loadSetup: async () => {
    set({ setup: await api.get<SetupInfo>('/setup') });
  },

  loadUser: async () => {
    try {
      set({ user: await api.get<UserDto>('/auth/me'), userChecked: true });
    } catch {
      set({ user: null, userChecked: true });
    }
  },

  login: async (email, password) => {
    set({ user: await api.post<UserDto>('/auth/login', { email, password }), userChecked: true });
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      set({ user: null, userChecked: true });
    }
  },
}));

// Si la sesión vence mientras se usa la app, cualquier 401 la da por cerrada y la ruta protegida
// lleva al inicio de sesión.
setUnauthorizedHandler(() => useSessionStore.setState({ user: null, userChecked: true }));

/** Admin y Editor modifican registros; Consulta solo los ve (RF-10, RF-13). */
export function useCanEdit(): boolean {
  return useSessionStore((state) => state.user?.role === 'admin' || state.user?.role === 'editor');
}

export const ROLE_LABELS: Record<UserDto['role'], string> = {
  admin: 'Admin',
  editor: 'Editor',
  consulta: 'Consulta',
};
