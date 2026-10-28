import { CheckCircleOutlined, RollbackOutlined } from '@ant-design/icons';
import type { ReviewInvoiceDto, ReviewPaymentDto } from '@api-types';
import { App, Space, Table, Tag, Typography } from 'antd';
import { EmailList } from '../../components/EmailCard.tsx';
import { TableAction } from '../../components/TableAction.tsx';
import { formatDate, formatMoney, formatPeriod } from '../../format.ts';
import { INVOICE_STATUS_TAGS } from '../invoices/InvoicesPage.tsx';
import { changeInvoiceStatus } from './status-change.ts';

/**
 * Facturas en Pago recibido o Revisión manual con su evidencia y motivo (RF-141); un Admin o Editor las
 * pasa a Pagada o las devuelve a Pendiente de pago (RF-143 a RF-146).
 */
export function PaymentsTab({
  payments,
  loading,
  canEdit,
  reload,
}: {
  payments: ReviewPaymentDto[];
  loading: boolean;
  canEdit: boolean;
  reload: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const decide = (invoice: ReviewInvoiceDto, to: 'pagada' | 'pendiente_de_pago') =>
    changeInvoiceStatus(message, invoice, to, reload);

  return (
    <Table<ReviewPaymentDto>
      rowKey={(payment) => payment.invoice.id}
      loading={loading}
      dataSource={payments}
      pagination={{ pageSize: 20, hideOnSinglePage: true }}
      scroll={{ x: true }}
      locale={{ emptyText: 'No hay pagos para revisar.' }}
      expandable={{ expandedRowRender: (payment) => <EmailList emails={payment.emails} /> }}
      columns={[
        {
          title: 'Factura',
          key: 'numero',
          render: (_, { invoice }) => <span style={{ whiteSpace: 'nowrap' }}>{invoice.voucherNumber}</span>,
        },
        { title: 'Cliente', key: 'cliente', render: (_, { invoice }) => invoice.clientName },
        { title: 'Período', key: 'periodo', render: (_, { invoice }) => formatPeriod(invoice.period) },
        { title: 'Vencimiento', key: 'vencimiento', render: (_, { invoice }) => formatDate(invoice.dueDate) },
        {
          title: 'Total',
          key: 'total',
          align: 'right',
          render: (_, { invoice }) => (
            <span style={{ whiteSpace: 'nowrap' }}>{formatMoney(invoice.totalCents, 'ARS')}</span>
          ),
        },
        {
          title: 'Estado',
          key: 'estado',
          render: (_, { invoice }) => (
            <Tag color={INVOICE_STATUS_TAGS[invoice.status].color}>{INVOICE_STATUS_TAGS[invoice.status].label}</Tag>
          ),
        },
        {
          title: 'Motivo',
          key: 'motivo',
          render: (_, { invoice }) =>
            invoice.reason && <Typography.Text type="danger">{invoice.reason}</Typography.Text>,
        },
        ...(canEdit
          ? [
              {
                title: 'Acciones',
                key: 'acciones',
                align: 'center' as const,
                width: 110,
                render: (_: unknown, { invoice }: ReviewPaymentDto) => (
                  <Space size={4}>
                    <TableAction
                      label="Pasar a Pagada"
                      icon={<CheckCircleOutlined />}
                      confirm="¿Confirmás que el pago se realizó?"
                      confirmDescription="La factura pasa a Pagada y deja de contar como deuda."
                      onClick={() => decide(invoice, 'pagada')}
                    />
                    <TableAction
                      label="Devolver a Pendiente de pago"
                      icon={<RollbackOutlined />}
                      danger
                      confirm="¿El pago no se realizó?"
                      confirmDescription="La factura vuelve a Pendiente de pago."
                      onClick={() => decide(invoice, 'pendiente_de_pago')}
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
