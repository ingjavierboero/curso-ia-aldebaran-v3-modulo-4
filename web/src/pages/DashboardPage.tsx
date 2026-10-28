import { MailOutlined } from '@ant-design/icons';
import type { DashboardDto, DebtorDto } from '@api-types';
import { App, Card, Space, Table, Tag, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client.ts';
import { Banners } from '../components/Banners.tsx';
import { TableAction } from '../components/TableAction.tsx';
import { errorMessage } from '../forms.ts';
import { formatMoney } from '../format.ts';
import { useSessionStore } from '../stores/session.ts';

/** Solo un cliente Activo, con deuda y sin revisión puede recibir el recordatorio (RF-96, RF-157). */
const canRemind = (debtor: DebtorDto) => debtor.clientStatus === 'activo' && !debtor.inReview;

/**
 * Inicio y dashboard: saluda al usuario, muestra los banners y el listado de clientes con deuda vigente
 * (RF-153), desde donde cualquier perfil envía el recordatorio manual (RF-12, RF-154).
 */
export function DashboardPage() {
  const user = useSessionStore((state) => state.user);
  const { message } = App.useApp();
  const [debtors, setDebtors] = useState<DebtorDto[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setDebtors((await api.get<DashboardDto>('/dashboard')).debtors);
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remind(debtor: DebtorDto) {
    try {
      await api.post(`/clients/${debtor.clientId}/reminder`);
      message.success(`Recordatorio enviado a ${debtor.businessName}.`);
    } catch (e) {
      // El cliente pudo cambiar (pagó, entró en revisión o se dio de baja): se muestra el estado vigente.
      message.error(errorMessage(e));
      await load();
    }
  }

  return (
    <>
      <Typography.Title level={3}>Hola, {user?.name}</Typography.Title>
      <Banners />
      <Card title="Clientes con deuda vigente">
        <Table<DebtorDto>
          rowKey="clientId"
          loading={loading}
          dataSource={debtors}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          scroll={{ x: true }}
          locale={{ emptyText: 'No hay clientes con deuda vigente.' }}
          columns={[
            {
              title: 'Cliente',
              key: 'cliente',
              render: (_, debtor) => (
                <Space size={8} wrap>
                  <Link to={`/clientes/${debtor.clientId}`}>{debtor.businessName}</Link>
                  {debtor.clientStatus === 'inactivo' && <Tag>Inactivo</Tag>}
                </Space>
              ),
            },
            {
              title: 'Deuda vigente',
              dataIndex: 'debtCents',
              align: 'right',
              render: (cents: number) => <span style={{ whiteSpace: 'nowrap' }}>{formatMoney(cents, 'ARS')}</span>,
            },
            { title: 'Facturas adeudadas', dataIndex: 'owedInvoices', align: 'center' },
            {
              title: 'Revisión',
              dataIndex: 'inReview',
              render: (inReview: boolean) => inReview && <Tag color="gold">En revisión</Tag>,
            },
            {
              title: 'Acciones',
              key: 'acciones',
              align: 'center',
              width: 100,
              render: (_, debtor) =>
                canRemind(debtor) && (
                  <TableAction
                    label="Enviar recordatorio"
                    icon={<MailOutlined />}
                    confirm={`¿Enviar el recordatorio a ${debtor.businessName}?`}
                    confirmDescription="Le llega un email con cada factura adeudada y el total a pagar."
                    onClick={() => remind(debtor)}
                  />
                ),
            },
          ]}
        />
      </Card>
    </>
  );
}
