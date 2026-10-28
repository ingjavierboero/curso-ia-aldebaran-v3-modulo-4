import { CheckOutlined, PaperClipOutlined } from '@ant-design/icons';
import type { NoticeDto } from '@api-types';
import { App, Space, Table } from 'antd';
import { api } from '../../api/client.ts';
import { TableAction } from '../../components/TableAction.tsx';
import { errorMessage } from '../../forms.ts';
import { formatDateTime } from '../../format.ts';

/** Avisos Pendientes: emails de remitentes que no son clientes (RF-142); se marcan como revisados (RF-148). */
export function NoticesTab({
  notices,
  loading,
  canEdit,
  reload,
}: {
  notices: NoticeDto[];
  loading: boolean;
  canEdit: boolean;
  reload: () => Promise<void>;
}) {
  const { message } = App.useApp();

  async function markReviewed(notice: NoticeDto) {
    try {
      await api.post(`/review/notices/${notice.id}/reviewed`);
      message.success('Aviso marcado como revisado.');
    } catch (e) {
      message.error(errorMessage(e));
    }
    await reload();
  }

  return (
    <Table<NoticeDto>
      rowKey="id"
      loading={loading}
      dataSource={notices}
      pagination={{ pageSize: 20, hideOnSinglePage: true }}
      scroll={{ x: true }}
      locale={{ emptyText: 'No hay avisos pendientes.' }}
      columns={[
        { title: 'Remitente', key: 'remitente', render: (_, { email }) => email.from },
        { title: 'Asunto', key: 'asunto', render: (_, { email }) => email.subject || '(sin asunto)' },
        {
          title: 'Fecha',
          key: 'fecha',
          render: (_, { email }) => <span style={{ whiteSpace: 'nowrap' }}>{formatDateTime(email.receivedAt)}</span>,
        },
        {
          title: 'Adjuntos',
          key: 'adjuntos',
          render: (_, { email }) => (
            <Space orientation="vertical" size={0}>
              {email.attachments.map((attachment) => (
                // Se abre con la descarga segura de la API (RNF-16).
                <a
                  key={attachment.id}
                  href={`/api/attachments/${attachment.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <PaperClipOutlined aria-hidden /> {attachment.filename}
                </a>
              ))}
            </Space>
          ),
        },
        ...(canEdit
          ? [
              {
                title: 'Acciones',
                key: 'acciones',
                align: 'center' as const,
                width: 100,
                render: (_: unknown, notice: NoticeDto) => (
                  <TableAction
                    label="Marcar como revisado"
                    icon={<CheckOutlined />}
                    onClick={() => markReviewed(notice)}
                  />
                ),
              },
            ]
          : []),
      ]}
    />
  );
}
