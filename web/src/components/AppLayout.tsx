import { Button, Dropdown, Layout, Space, Tag, Typography } from 'antd';
import { useEffect } from 'react';
import { Link, Outlet, useNavigate } from 'react-router';
import { ROLE_LABELS, useSessionStore } from '../stores/session.ts';
import { ThemeSelector } from '../theme/theme.tsx';

const { Header, Content } = Layout;

/**
 * Estructura común de todas las pantallas: header con el nombre del sistema, el indicador de
 * redirección de emails (RF-220), el menú del usuario con sesión y el selector de tema (RNF-15).
 */
export function AppLayout() {
  const setup = useSessionStore((state) => state.setup);
  const user = useSessionStore((state) => state.user);
  const loadSetup = useSessionStore((state) => state.loadSetup);
  const logout = useSessionStore((state) => state.logout);
  const navigate = useNavigate();

  useEffect(() => {
    loadSetup().catch(() => {
      // Sin conexión con el server: las pantallas muestran su propio error al usar la API.
    });
  }, [loadSetup]);

  const userMenu = {
    items: [
      { key: 'perfil', label: <Link to="/perfil">Mi perfil</Link> },
      { key: 'salir', label: 'Cerrar sesión' },
    ],
    onClick: async ({ key }: { key: string }) => {
      if (key !== 'salir') return;
      await logout().catch(() => {});
      navigate('/login');
    },
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <Space size="middle">
          <Typography.Title level={4} style={{ margin: 0, color: 'inherit' }}>
            <Link to="/" style={{ color: 'inherit' }}>
              Aldebaran
            </Link>
          </Typography.Title>
          {setup?.emailRedirectTo && <Tag color="warning">Emails redirigidos a {setup.emailRedirectTo}</Tag>}
        </Space>
        <Space size="middle">
          {user && (
            <Dropdown menu={userMenu} trigger={['click']}>
              <Button type="text" style={{ color: 'inherit' }}>
                {user.name} · {ROLE_LABELS[user.role]}
              </Button>
            </Dropdown>
          )}
          <ThemeSelector />
        </Space>
      </Header>
      <Content style={{ padding: 24 }}>
        <Outlet />
      </Content>
    </Layout>
  );
}
