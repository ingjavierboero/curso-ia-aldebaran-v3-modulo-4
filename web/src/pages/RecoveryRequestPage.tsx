import { MailOutlined } from '@ant-design/icons';
import { Alert, Button, Form, Input, Result } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client.ts';
import { AuthCard } from '../components/AuthCard.tsx';
import { emailRules, errorMessage } from '../forms.ts';

/** Pedido de recuperación de contraseña (RF-23). El mensaje es el mismo para cualquier email (RF-25). */
export function RecoveryRequestPage() {
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit(values: { email: string }) {
    setSending(true);
    setError(null);
    try {
      const { message } = await api.post<{ message: string }>('/auth/recovery', values);
      setConfirmation(message);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  if (confirmation) {
    return (
      <AuthCard title="Recuperar contraseña">
        <Result status="success" subTitle={confirmation} extra={<Link to="/login">Volver al inicio de sesión</Link>} />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Recuperar contraseña">
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
      <Form<{ email: string }> layout="vertical" onFinish={submit} requiredMark={false}>
        <Form.Item label="Email" name="email" rules={emailRules}>
          <Input type="email" prefix={<MailOutlined />} autoComplete="username" autoFocus />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={sending}>
          Enviar link de recuperación
        </Button>
      </Form>
      <div style={{ marginTop: 16, textAlign: 'center' }}>
        <Link to="/login">Volver al inicio de sesión</Link>
      </div>
    </AuthCard>
  );
}
