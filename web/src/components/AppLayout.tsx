import { Layout, Typography } from 'antd';
import { Outlet } from 'react-router';
import { ThemeSelector } from '../theme/theme.tsx';

const { Header, Content } = Layout;

/** Estructura común de todas las pantallas: header con el nombre del sistema y el selector de tema. */
export function AppLayout() {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <Typography.Title level={4} style={{ margin: 0, color: 'inherit' }}>
          Aldebaran
        </Typography.Title>
        <ThemeSelector />
      </Header>
      <Content style={{ padding: 24 }}>
        <Outlet />
      </Content>
    </Layout>
  );
}
