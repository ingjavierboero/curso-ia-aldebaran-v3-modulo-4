import { PaperClipOutlined, PlusOutlined } from '@ant-design/icons';
import type { MockEmailDto } from '@api-types';
import { Alert, App, Button, Result, Space, Table, Tag, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { api } from '../../api/client.ts';
import { errorMessage } from '../../forms.ts';
import { formatDateTime } from '../../format.ts';
import { useCanEdit, useSessionStore } from '../../stores/session.ts';
import { ReceivedEmailForm, type ReceivedEmailInput } from './ReceivedEmailForm.tsx';

const Toolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const Body = styled.pre`
  margin: 0 0 8px;
  white-space: pre-wrap;
  font-family: inherit;
`;

const DIRECTIONS: Record<MockEmailDto['direction'], { color: string; label: string }> = {
  enviado: { color: 'blue', label: 'Enviado' },
  recibido: { color: 'green', label: 'Recibido' },
};

/** Cuerpo y adjuntos de un email; los adjuntos se abren con la descarga segura de la API (RNF-16). */
function EmailDetail({ email }: { email: MockEmailDto }) {
  return (
    <>
      <Body>{email.body || '(sin cuerpo)'}</Body>
      <Space orientation="vertical" size={0}>
        {email.attachments.map((attachment) => (
          <a
            key={attachment.id}
            href={`/api/mock-mailbox/${email.id}/attachments/${attachment.id}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <PaperClipOutlined aria-hidden /> {attachment.filename}
          </a>
        ))}
      </Space>
    </>
  );
}

/**
 * Casilla simulada del modo mock (RF-194 a RF-204): reemplaza a Gmail. Un Admin ve lo enviado y lo
 * recibido; Editor y Consulta, solo lo recibido de clientes. Admin y Editor cargan emails recibidos,
 * que el agente procesa en la siguiente revisión de la casilla.
 */
export function MockMailboxPage() {
  const mode = useSessionStore((state) => state.setup?.mode);
  const canEdit = useCanEdit();
  const { message } = App.useApp();
  const [emails, setEmails] = useState<MockEmailDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingEmail, setLoadingEmail] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEmails(await api.get<MockEmailDto[]>('/mock-mailbox'));
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    if (mode !== 'homologacion') void load();
  }, [load, mode]);

  // RF-204: fuera del modo mock la casilla simulada no existe.
  if (mode === 'homologacion') {
    return <Result status="403" title="La casilla simulada solo está disponible en modo mock." />;
  }

  async function loadReceived(input: ReceivedEmailInput) {
    await api.post('/mock-mailbox/received', input);
    setLoadingEmail(false);
    message.success('Email cargado en la casilla simulada: se procesa en la siguiente revisión de la casilla.');
    await load();
  }

  return (
    <>
      <Toolbar>
        <Typography.Title level={3}>Casilla simulada</Typography.Title>
        {canEdit && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setLoadingEmail(true)}>
            Cargar email recibido
          </Button>
        )}
      </Toolbar>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title="En modo mock los emails no salen ni llegan por Gmail: quedan en esta casilla (aldebaran-mock@gmail.com)."
        description={
          'El agente clasifica cada adjunto por su nombre: pago_<CUIT>_<monto>.pdf es un comprobante (una "x" en ' +
          'lugar del CUIT o del monto es un dato que no se pudo extraer), dudoso_... es dudoso, error_... falla y ' +
          'cualquier otro nombre no es un comprobante.'
        }
      />
      <Table<MockEmailDto>
        rowKey="id"
        loading={loading}
        dataSource={emails}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        scroll={{ x: true }}
        locale={{ emptyText: 'La casilla simulada está vacía.' }}
        expandable={{ expandRowByClick: true, expandedRowRender: (email) => <EmailDetail email={email} /> }}
        columns={[
          {
            title: 'Dirección',
            dataIndex: 'direction',
            render: (direction: MockEmailDto['direction']) => (
              <Tag color={DIRECTIONS[direction].color}>{DIRECTIONS[direction].label}</Tag>
            ),
          },
          {
            title: 'Fecha',
            dataIndex: 'createdAt',
            render: (at: string) => <span style={{ whiteSpace: 'nowrap' }}>{formatDateTime(at)}</span>,
          },
          { title: 'De', dataIndex: 'from' },
          { title: 'Para', dataIndex: 'to' },
          { title: 'Asunto', dataIndex: 'subject', render: (subject: string) => subject || '(sin asunto)' },
          {
            title: 'Adjuntos',
            key: 'adjuntos',
            align: 'center',
            render: (_, email) => email.attachments.length || '',
          },
        ]}
      />
      {loadingEmail && <ReceivedEmailForm onSubmit={loadReceived} onClose={() => setLoadingEmail(false)} />}
    </>
  );
}
