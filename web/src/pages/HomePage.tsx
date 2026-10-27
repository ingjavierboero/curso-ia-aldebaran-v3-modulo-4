import { Typography } from 'antd';
import { Banners } from '../components/Banners.tsx';
import { useSessionStore } from '../stores/session.ts';

/** Inicio: saluda al usuario y muestra los banners del dashboard; la deuda se suma en US6. */
export function HomePage() {
  const user = useSessionStore((state) => state.user);
  return (
    <>
      <Typography.Title level={3}>Hola, {user?.name}</Typography.Title>
      <Banners />
      <Typography.Paragraph type="secondary">
        Desde el menú de la izquierda accedés a las secciones de tu perfil.
      </Typography.Paragraph>
    </>
  );
}
