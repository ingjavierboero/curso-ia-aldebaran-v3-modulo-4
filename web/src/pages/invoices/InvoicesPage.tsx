import { CheckCircleOutlined } from '@ant-design/icons';
import type { InvoiceDto } from '@api-types';
import { App, Table, Tag, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { errorMessage } from '../../forms.ts';
import { TableAction } from '../../components/TableAction.tsx';
import { formatDate, formatMoney, formatPeriod } from '../../format.ts';
import { useCanEdit } from '../../stores/session.ts';
import { changeInvoiceStatus } from '../review/status-change.ts';
import { BillingCard } from './BillingCard.tsx';

/** Etiqueta y color fijo de cada estado de factura (plan.md, Diseño de la interfaz). */
export const INVOICE_STATUS_TAGS: Record<InvoiceDto['status'], { color: string; label: string }> = {
  pendiente_de_pago: { color: 'gold', label: 'Pendiente de pago' },
  pago_recibido: { color: 'blue', label: 'Pago recibido' },
  revision_manual: { color: 'volcano', label: 'Revisión manual' },
  pagada: { color: 'green', label: 'Pagada' },
};

/**
 * Facturas: el estado de la facturación del mes con sus acciones y el listado de facturas emitidas
 * (RF-160), donde un Admin o Editor pasa a Pagada una factura Pendiente de pago (RF-147). Los filtros, el
 * detalle y el PDF se suman en US8.
 */
export function InvoicesPage() {
  const { message } = App.useApp();
  const canEdit = useCanEdit();
  const [invoices, setInvoices] = useState<InvoiceDto[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setInvoices(await api.get<InvoiceDto[]>('/invoices'));
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <Typography.Title level={3}>Facturas</Typography.Title>
      <BillingCard onFinished={load} />
      <Table<InvoiceDto>
        rowKey="id"
        loading={loading}
        dataSource={invoices}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        scroll={{ x: true }}
        locale={{ emptyText: 'Todavía no hay facturas.' }}
        columns={[
          {
            title: 'Factura',
            dataIndex: 'voucherNumber',
            render: (number: string) => <span style={{ whiteSpace: 'nowrap' }}>{number}</span>,
          },
          { title: 'Cliente', dataIndex: 'clientName' },
          { title: 'Período', dataIndex: 'period', render: (period: string) => formatPeriod(period) },
          { title: 'Emisión', dataIndex: 'issueDate', render: (date: string) => formatDate(date) },
          { title: 'Vencimiento', dataIndex: 'dueDate', render: (date: string) => formatDate(date) },
          {
            title: 'Total',
            dataIndex: 'totalCents',
            align: 'right',
            render: (cents: number) => <span style={{ whiteSpace: 'nowrap' }}>{formatMoney(cents, 'ARS')}</span>,
          },
          {
            title: 'Estado',
            dataIndex: 'status',
            render: (status: InvoiceDto['status']) => (
              <Tag color={INVOICE_STATUS_TAGS[status].color}>{INVOICE_STATUS_TAGS[status].label}</Tag>
            ),
          },
          ...(canEdit
            ? [
                {
                  title: 'Acciones',
                  key: 'acciones',
                  align: 'center' as const,
                  width: 100,
                  // RF-147: un Admin o Editor pasa a Pagada una factura Pendiente de pago.
                  render: (_: unknown, invoice: InvoiceDto) =>
                    invoice.status === 'pendiente_de_pago' && (
                      <TableAction
                        label="Pasar a Pagada"
                        icon={<CheckCircleOutlined />}
                        confirm="¿Pasar la factura a Pagada?"
                        confirmDescription="Deja de contar como deuda del cliente."
                        onClick={() => changeInvoiceStatus(message, invoice, 'pagada', load)}
                      />
                    ),
                },
              ]
            : []),
        ]}
      />
    </>
  );
}
