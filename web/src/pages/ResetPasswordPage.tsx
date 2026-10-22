import { Alert, Button, Form, Input, Spin } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ApiError, api } from '../api/client.ts';
import { AuthCard } from '../components/AuthCard.tsx';
import { errorMessage, type LoginNotice, newPasswordRules } from '../forms.ts';

/** RF-31: a los 5 segundos del error de token inválido se vuelve al inicio de sesión. */
const REDIRECT_DELAY_MS = 5_000;

type Status = 'checking' | 'valid' | 'invalid';

/** Cambio de contraseña con el token del email de recuperación (RF-29 a RF-33). */
export function ResetPasswordPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>('checking');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // RF-29: el token se valida al ingresar a la URL.
  useEffect(() => {
    let active = true;
    api
      .get(`/auth/recovery/${token}`)
      .then(() => active && setStatus('valid'))
      .catch(() => active && setStatus('invalid'));
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    if (status !== 'invalid') return;
    const timer = setTimeout(() => navigate('/login', { replace: true }), REDIRECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status, navigate]);

  async function submit(values: { newPassword: string }) {
    setSending(true);
    setError(null);
    try {
      // RF-29: el server vuelve a validar el token al confirmar.
      await api.post(`/auth/recovery/${token}`, { newPassword: values.newPassword });
      const state: LoginNotice = { notice: 'Tu contraseña se cambió. Iniciá sesión con la nueva.' };
      navigate('/login', { replace: true, state }); // RF-33
    } catch (e) {
      if (e instanceof ApiError && e.code === 'token_invalido') setStatus('invalid');
      else setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  if (status === 'checking') return <Spin style={{ display: 'block', margin: '48px auto' }} />;

  return (
    <AuthCard title="Elegir una nueva contraseña">
      {status === 'invalid' ? (
        <Alert
          type="error"
          title="El link de recuperación no es válido o venció."
          description="En unos segundos te llevamos al inicio de sesión para que pidas uno nuevo."
        />
      ) : (
        <>
          {error && <Alert type="error" title={error} style={{ marginBottom: 16 }} />}
          <Form<{ newPassword: string }> layout="vertical" onFinish={submit} requiredMark={false}>
            <Form.Item label="Nueva contraseña" name="newPassword" rules={newPasswordRules}>
              <Input.Password autoComplete="new-password" autoFocus />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={sending}>
              Cambiar contraseña
            </Button>
          </Form>
        </>
      )}
    </AuthCard>
  );
}
