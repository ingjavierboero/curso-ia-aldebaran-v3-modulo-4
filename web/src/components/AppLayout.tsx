import { HomeOutlined, SettingOutlined, UserOutlined } from '@ant-design/icons';
import type { Role } from '@api-types';
import { Layout, Menu, Space, Tag, Typography, theme } from 'antd';
import { type ReactNode, useEffect } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { useSessionStore } from '../stores/session.ts';
import { ThemeSelector } from '../theme/theme.tsx';
import { UserMenu } from './UserMenu.tsx';

const { Header, Sider, Content } = Layout;

const ALL_ROLES: Role[] = ['admin', 'editor', 'consulta'];

/** Secciones del menú lateral y los perfiles que las ven (RF-06 a RF-11); cada historia agrega las suyas. */
const SECTIONS: Array<{ path: string; label: string; icon: ReactNode; roles: Role[] }> = [
  { path: '/', label: 'Inicio', icon: <HomeOutlined />, roles: ALL_ROLES },
  { path: '/usuarios', label: 'Usuarios', icon: <UserOutlined />, roles: ['admin'] },
  { path: '/configuracion', label: 'Configuración', icon: <SettingOutlined />, roles: ALL_ROLES },
];

/**
 * Estructura común de todas las pantallas: header con el nombre del sistema, el indicador de
 * redirección de emails (RF-220) y el selector de tema (RNF-15): con sesión va dentro del menú del
 * usuario, junto con el menú lateral de las secciones de su perfil.
 */
export function AppLayout() {
  const setup = useSessionStore((state) => state.setup);
  const user = useSessionStore((state) => state.user);
  const loadSetup = useSessionStore((state) => state.loadSetup);
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const { pathname } = useLocation();
  const sections = user ? SECTIONS.filter((section) => section.roles.includes(user.role)) : [];
  // /usuarios/12 marca "Usuarios" en el menú.
  const currentSection = `/${pathname.split('/')[1] ?? ''}`;

  useEffect(() => {
    loadSetup().catch(() => {
      // Sin conexión con el server: las pantallas muestran su propio error al usar la API.
    });
  }, [loadSetup]);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* Header claro, como el menú lateral; los colores salen del tema para el modo oscuro. */}
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '0 24px',
          background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Space size="middle">
          <Typography.Title level={4} style={{ margin: 0, color: 'inherit' }}>
            <Link to="/" style={{ color: 'inherit' }}>
              Aldebaran
            </Link>
          </Typography.Title>
          {setup?.emailRedirectTo && <Tag color="warning">Emails redirigidos a {setup.emailRedirectTo}</Tag>}
        </Space>
        {user ? <UserMenu user={user} /> : <ThemeSelector />}
      </Header>
      <Layout>
        {sections.length > 0 && (
          <Sider
            breakpoint="lg"
            collapsedWidth={0}
            theme="light"
            width={220}
            style={{ borderRight: `1px solid ${token.colorBorderSecondary}` }}
          >
            <Menu
              mode="inline"
              selectedKeys={[currentSection]}
              items={sections.map(({ path, label, icon }) => ({ key: path, icon, label }))}
              onClick={({ key }) => navigate(key)}
              style={{ height: '100%', borderInlineEnd: 0 }}
            />
          </Sider>
        )}
        <Content style={{ padding: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
