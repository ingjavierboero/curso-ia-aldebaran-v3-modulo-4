import { Alert, Button, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { api } from '../api/client.ts';
import { AuthCard } from '../components/AuthCard.tsx';
import { emailRules, errorMessage, type LoginNotice, newPasswordRules } from '../forms.ts';
import { useSessionStore } from '../stores/session.ts';

interface FirstAdminForm {
  name: string;
  email: string;
  password: string;
}

/** Registro del primer Admin, solo mientras no exista ningún usuario (RF-04, RF-05). */
export function FirstAdminPage() {
  const setup = useSessionStore((state) => state.setup);
  const loadSetup = useSessionStore((state) => state.loadSetup);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  if (setup && !setup.needsFirstAdmin) return <Navigate to="/login" replace />;

  async function submit(values: FirstAdminForm) {
    setSending(true);
    setError(null);
    try {
      await api.post('/setup/first-admin', values);
      // Se relee el estado inicial para que las rutas protegidas ya no lleven a esta pantalla.
      await loadSetup();
      const state: LoginNotice = { notice: 'El Admin quedó registrado. Ya podés iniciar sesión.' };
      navigate('/login', { replace: true, state });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <AuthCard title="Registrar el primer Admin">
      <Typography.Paragraph type="secondary">
        Todavía no hay usuarios. El primero que se registra queda con perfil Admin.
      </Typography.Paragraph>
      {error && <Alert type="error" title={error} style={{ marginBottom: 16 }} />}
      <Form<FirstAdminForm> layout="vertical" onFinish={submit} requiredMark={false}>
        <Form.Item
          label="Nombre"
          name="name"
          rules={[{ required: true, whitespace: true, message: 'El nombre es obligatorio.' }]}
        >
          <Input autoComplete="name" autoFocus />
        </Form.Item>
        <Form.Item label="Email" name="email" rules={emailRules}>
          <Input type="email" autoComplete="username" />
        </Form.Item>
        <Form.Item label="Contraseña" name="password" rules={newPasswordRules}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={sending}>
          Registrar
        </Button>
      </Form>
    </AuthCard>
  );
}
