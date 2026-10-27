import { DownOutlined, LogoutOutlined, UserOutlined } from '@ant-design/icons';
import type { UserDto } from '@api-types';
import { Avatar, Button, Divider, Dropdown, Space, Tag, theme, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ROLE_LABELS, useSessionStore } from '../stores/session.ts';
import { ThemeSelector } from '../theme/theme.tsx';

const ROLE_COLORS: Record<UserDto['role'], string> = { admin: 'gold', editor: 'blue', consulta: 'default' };

/** Iniciales del nombre para el avatar: "Ana María Pérez" → "AM". */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Menú del usuario con sesión, en el header: sus datos y perfil, el selector de tema (RNF-15), el
 * acceso a su perfil y el cierre de sesión.
 */
export function UserMenu({ user }: { user: UserDto }) {
  const logout = useSessionStore((state) => state.logout);
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);

  const items = [
    { key: 'perfil', icon: <UserOutlined />, label: 'Mi perfil' },
    { type: 'divider' as const },
    { key: 'salir', icon: <LogoutOutlined />, label: 'Cerrar sesión', danger: true },
  ];

  async function onClick({ key }: { key: string }) {
    setOpen(false);
    if (key === 'perfil') {
      navigate('/perfil');
      return;
    }
    await logout().catch(() => {});
    navigate('/login');
  }

  const avatar = (size: number) => (
    <Avatar size={size} style={{ backgroundColor: token.colorPrimary, flexShrink: 0 }}>
      {initials(user.name)}
    </Avatar>
  );

  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      trigger={['click']}
      placement="bottomRight"
      // Dentro del panel, el menú no lleva su propio fondo ni sombra.
      menu={{ items, onClick, style: { boxShadow: 'none', background: 'transparent' } }}
      popupRender={(menu) => (
        <div
          style={{
            width: 280,
            background: token.colorBgElevated,
            borderRadius: token.borderRadiusLG,
            boxShadow: token.boxShadowSecondary,
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 16 }}>
            {avatar(44)}
            <div style={{ minWidth: 0 }}>
              <Typography.Text strong ellipsis style={{ display: 'block' }}>
                {user.name}
              </Typography.Text>
              <Typography.Text type="secondary" ellipsis style={{ display: 'block', fontSize: token.fontSizeSM }}>
                {user.email}
              </Typography.Text>
              <Tag color={ROLE_COLORS[user.role]} style={{ marginTop: 4 }}>
                {ROLE_LABELS[user.role]}
              </Tag>
            </div>
          </div>
          <Divider style={{ margin: 0 }} />
          <div style={{ padding: '12px 16px' }}>
            <Typography.Text type="secondary" style={{ display: 'block', fontSize: token.fontSizeSM, marginBottom: 8 }}>
              Tema
            </Typography.Text>
            <ThemeSelector block />
          </div>
          <Divider style={{ margin: 0 }} />
          <div style={{ padding: 4 }}>{menu}</div>
        </div>
      )}
    >
      <Button type="text" style={{ color: 'inherit', height: 'auto', padding: '4px 8px' }}>
        <Space size={8}>
          {avatar(32)}
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 }}>
            <span>{user.name}</span>
            <span style={{ fontSize: token.fontSizeSM, opacity: 0.65 }}>{ROLE_LABELS[user.role]}</span>
          </span>
          <DownOutlined style={{ fontSize: 10, opacity: 0.65 }} />
        </Space>
      </Button>
    </Dropdown>
  );
}
