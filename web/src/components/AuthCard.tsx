import { Card, Typography } from 'antd';
import type { ReactNode } from 'react';

/** Tarjeta centrada de las pantallas sin sesión: login, primer Admin y recuperación de contraseña. */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card style={{ maxWidth: 420, margin: '48px auto' }}>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        {title}
      </Typography.Title>
      {children}
    </Card>
  );
}
