import { Spin } from 'antd';
import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useSessionStore } from '../stores/session.ts';

/**
 * Protege las pantallas que requieren sesión (RF-01): sin usuarios lleva al registro del primer Admin
 * (RF-04) y sin sesión, al inicio de sesión, recordando a qué pantalla se quería entrar.
 */
export function RequireSession() {
  const setup = useSessionStore((state) => state.setup);
  const user = useSessionStore((state) => state.user);
  const userChecked = useSessionStore((state) => state.userChecked);
  const loadUser = useSessionStore((state) => state.loadUser);
  const location = useLocation();

  useEffect(() => {
    if (!userChecked) void loadUser();
  }, [userChecked, loadUser]);

  if (!setup || !userChecked) return <Spin style={{ display: 'block', margin: '48px auto' }} />;
  if (setup.needsFirstAdmin) return <Navigate to="/primer-admin" replace />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}
