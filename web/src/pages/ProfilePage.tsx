import { Alert, Button, Card, Descriptions, Form, Input } from 'antd';
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
  const [form] = Form.useForm<PasswordForm>();
  const [result, setResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [sending, setSending] = useState(false);

  if (!user) return null;

  async function submit(values: PasswordForm) {
    setSending(true);
    setResult(null);
    try {
      await api.post('/auth/password', values);
      form.resetFields();
      setResult({ type: 'success', text: 'La contraseña se cambió. Se cerraron tus otras sesiones abiertas.' });
    } catch (e) {
      setResult({ type: 'error', text: errorMessage(e) });
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
        {result && <Alert type={result.type} title={result.text} style={{ marginBottom: 16 }} />}
        <Form<PasswordForm> form={form} layout="vertical" onFinish={submit} requiredMark={false}>
          <Form.Item
            label="Contraseña actual"
            name="currentPassword"
            rules={[{ required: true, message: 'La contraseña actual es obligatoria.' }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item label="Nueva contraseña" name="newPassword" rules={newPasswordRules}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={sending}>
            Cambiar contraseña
          </Button>
        </Form>
      </Card>
    </div>
  );
}
