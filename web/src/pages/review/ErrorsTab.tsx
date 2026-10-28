import { CheckOutlined, RedoOutlined } from '@ant-design/icons';
import type { ProcessErrorDto } from '@api-types';
import { App, Space, Table, Typography } from 'antd';
import { api } from '../../api/client.ts';
import { TableAction } from '../../components/TableAction.tsx';
import { errorMessage } from '../../forms.ts';
import { formatDateTime, formatPeriod } from '../../format.ts';

export const OPERATION_LABELS: Record<ProcessErrorDto['operation'], string> = {
  generacion_factura: 'Generación de factura',
  envio_factura: 'Envío de factura',
  envio_recordatorio: 'Envío de recordatorio',
  revision_casilla: 'Revisión de la casilla',
};

/** RF-176: la revisión de la casilla no se reintenta a mano; se reintenta sola en la siguiente revisión. */
const canRetry = (error: ProcessErrorDto) => error.operation !== 'revision_casilla';

/**
 * Errores de proceso Pendientes (RF-175): un Admin o Editor los reintenta con un único intento (RF-176 a
 * RF-179) o los marca como Resueltos (RF-180). Si la acción falla, se muestra el mensaje (RF-182).
 */
export function ErrorsTab({
  errors,
  loading,
  canEdit,
  reload,
}: {
  errors: ProcessErrorDto[];
  loading: boolean;
  canEdit: boolean;
  reload: () => Promise<void>;
}) {
  const { message } = App.useApp();

  async function act(error: ProcessErrorDto, action: 'retry' | 'resolve') {
    try {
      await api.post(`/review/errors/${error.id}/${action}`);
      message.success(
        action === 'retry' ? 'Reintento exitoso: el error quedó Resuelto.' : 'Error marcado como resuelto.',
      );
    } catch (e) {
      message.error(errorMessage(e));
    }
    await reload();
  }

  return (
    <Table<ProcessErrorDto>
      rowKey="id"
      loading={loading}
      dataSource={errors}
      pagination={{ pageSize: 20, hideOnSinglePage: true }}
      scroll={{ x: true }}
      locale={{ emptyText: 'No hay errores de proceso pendientes.' }}
      columns={[
        {
          title: 'Operación',
          dataIndex: 'operation',
          render: (operation: ProcessErrorDto['operation']) => OPERATION_LABELS[operation],
        },
        { title: 'Cliente', dataIndex: 'clientName', render: (name: string | null) => name ?? '—' },
        {
          title: 'Período',
          dataIndex: 'period',
          render: (period: string | null) => (period ? formatPeriod(period) : '—'),
        },
        {
          title: 'Factura',
          dataIndex: 'voucherNumber',
          render: (number: string | null) => number && <span style={{ whiteSpace: 'nowrap' }}>{number}</span>,
        },
        { title: 'Intentos', dataIndex: 'attempts', align: 'center' },
        {
          title: 'Último error',
          dataIndex: 'lastErrorMessage',
          render: (text: string) => <Typography.Text type="danger">{text}</Typography.Text>,
        },
        {
          title: 'Actualizado',
          dataIndex: 'updatedAt',
          render: (at: string) => <span style={{ whiteSpace: 'nowrap' }}>{formatDateTime(at)}</span>,
        },
        ...(canEdit
          ? [
              {
                title: 'Acciones',
                key: 'acciones',
                align: 'center' as const,
                width: 110,
                render: (_: unknown, error: ProcessErrorDto) => (
                  <Space size={4}>
                    {canRetry(error) && (
                      <TableAction
                        label="Reintentar"
                        icon={<RedoOutlined />}
                        confirm="¿Reintentar ahora?"
                        confirmDescription="Se hace un único intento; si falla, el error sigue Pendiente."
                        onClick={() => act(error, 'retry')}
                      />
                    )}
                    <TableAction
                      label="Marcar como resuelto"
                      icon={<CheckOutlined />}
                      confirm="¿Marcar el error como resuelto sin reintentarlo?"
                      onClick={() => act(error, 'resolve')}
                    />
                  </Space>
                ),
              },
            ]
          : []),
      ]}
    />
  );
}
