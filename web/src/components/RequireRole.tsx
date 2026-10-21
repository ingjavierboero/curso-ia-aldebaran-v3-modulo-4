import type { Role } from '@api-types';
import { Result } from 'antd';
import { Outlet } from 'react-router';
import { useSessionStore } from '../stores/session.ts';

/** Pantallas reservadas a ciertos perfiles; el server rechaza igual cualquier acción no permitida. */
export function RequireRole({ roles }: { roles: Role[] }) {
  const user = useSessionStore((state) => state.user);
  if (!user || !roles.includes(user.role)) {
    return <Result status="403" title="Sin permiso" subTitle="Tu perfil no tiene acceso a esta pantalla." />;
  }
  return <Outlet />;
}
