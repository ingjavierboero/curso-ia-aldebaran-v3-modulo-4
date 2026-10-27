import { LockOutlined, MailOutlined } from '@ant-design/icons';
import { Alert, Button, Form, Input } from 'antd';
import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { AuthCard } from '../components/AuthCard.tsx';
import { errorMessage, type LoginNotice } from '../forms.ts';
import { useSessionStore } from '../stores/session.ts';

interface LoginForm {
  email: string;
  password: string;
}

/** Inicio de sesión con email y contraseña (RF-02), con acceso a la recuperación (RF-23). */
export function LoginPage() {
  const setup = useSessionStore((state) => state.setup);
  const login = useSessionStore((state) => state.login);
  const navigate = useNavigate();
  const state = (useLocation().state ?? {}) as LoginNotice;
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  if (setup?.needsFirstAdmin) return <Navigate to="/primer-admin" replace />;

  async function submit(values: LoginForm) {
    setSending(true);
    setError(null);
    try {
      await login(values.email, values.password);
      navigate(state.from ?? '/', { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <AuthCard title="Iniciar sesión">
      {state.notice && <Alert type="success" showIcon title={state.notice} style={{ marginBottom: 16 }} />}
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
      <Form<LoginForm> layout="vertical" onFinish={submit} requiredMark={false}>
        <Form.Item label="Email" name="email" rules={[{ required: true, message: 'El email es obligatorio.' }]}>
          <Input type="email" prefix={<MailOutlined />} autoComplete="username" autoFocus />
        </Form.Item>
        <Form.Item
          label="Contraseña"
          name="password"
          rules={[{ required: true, message: 'La contraseña es obligatoria.' }]}
        >
          <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={sending}>
          Ingresar
        </Button>
      </Form>
      <div style={{ marginTop: 16, textAlign: 'center' }}>
        <Link to="/recuperar-contrasena">¿Olvidaste tu contraseña?</Link>
      </div>
    </AuthCard>
  );
}
