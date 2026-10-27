import { Typography } from 'antd';
import { useSessionStore } from '../stores/session.ts';

/** Inicio: saluda al usuario; el dashboard (US7) se suma debajo. */
export function HomePage() {
  const user = useSessionStore((state) => state.user);
  return (
    <>
      <Typography.Title level={3}>Hola, {user?.name}</Typography.Title>
      <Typography.Paragraph type="secondary">
        Desde el menú de la izquierda accedés a las secciones de tu perfil.
      </Typography.Paragraph>
    </>
  );
}
