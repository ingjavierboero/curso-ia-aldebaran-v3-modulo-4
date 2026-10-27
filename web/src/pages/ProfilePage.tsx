import { LockOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, Descriptions, Form, Input } from 'antd';
import { useState } from 'react';
import { api } from '../api/client.ts';
import { errorMessage, newPasswordRules } from '../forms.ts';
import { ROLE_LABELS, useSessionStore } from '../stores/session.ts';

interface PasswordForm {
  currentPassword: string;
  newPassword: string;
}

/** Datos del usuario con sesión y cambio de su propia contraseña (RF-21, RF-22). */
export function ProfilePage() {
  const user = useSessionStore((state) => state.user);
  const { message } = App.useApp();
  const [form] = Form.useForm<PasswordForm>();
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  if (!user) return null;

  async function submit(values: PasswordForm) {
    setSending(true);
    setError(null);
    try {
      await api.post('/auth/password', values);
      form.resetFields();
      message.success('La contraseña se cambió. Se cerraron tus otras sesiones abiertas.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 24, maxWidth: 560 }}>
      <Card title="Mi perfil">
        <Descriptions column={1}>
          <Descriptions.Item label="Nombre">{user.name}</Descriptions.Item>
          <Descriptions.Item label="Email">{user.email}</Descriptions.Item>
          <Descriptions.Item label="Perfil">{ROLE_LABELS[user.role]}</Descriptions.Item>
        </Descriptions>
      </Card>
      <Card title="Cambiar contraseña">
        {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
        <Form<PasswordForm> form={form} layout="vertical" onFinish={submit} requiredMark={false}>
          <Form.Item
            label="Contraseña actual"
            name="currentPassword"
            rules={[{ required: true, message: 'La contraseña actual es obligatoria.' }]}
          >
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
          </Form.Item>
          <Form.Item label="Nueva contraseña" name="newPassword" rules={newPasswordRules}>
            <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={sending}>
            Cambiar contraseña
          </Button>
        </Form>
      </Card>
    </div>
  );
}
