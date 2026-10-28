import { CheckCircleOutlined, FilePdfOutlined } from '@ant-design/icons';
import type { ClientDto, InvoiceDto } from '@api-types';
import { App, Button, DatePicker, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { api } from '../../api/client.ts';
import { errorMessage } from '../../forms.ts';
import { TableAction } from '../../components/TableAction.tsx';
import { formatDate, formatMoney, formatPeriod } from '../../format.ts';
import { useCanEdit } from '../../stores/session.ts';
import { changeInvoiceStatus } from '../review/status-change.ts';
import { BillingCard } from './BillingCard.tsx';
import { InvoiceDetail } from './InvoiceDetail.tsx';

const Toolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
`;

/** Etiqueta y color fijo de cada estado de factura (plan.md, Diseño de la interfaz). */
export const INVOICE_STATUS_TAGS: Record<InvoiceDto['status'], { color: string; label: string }> = {
  pendiente_de_pago: { color: 'gold', label: 'Pendiente de pago' },
  pago_recibido: { color: 'blue', label: 'Pago recibido' },
  revision_manual: { color: 'volcano', label: 'Revisión manual' },
  pagada: { color: 'green', label: 'Pagada' },
};

/**
 * Facturas: el estado de la facturación del mes con sus acciones y el listado de facturas emitidas
 * (RF-160), filtrable por estado, cliente y período (RF-168). Cada factura abre su detalle (RF-217) y
 * descarga su PDF (RF-162); un Admin o Editor pasa a Pagada una factura Pendiente de pago (RF-147).
 */
export function InvoicesPage() {
  const { message } = App.useApp();
  const canEdit = useCanEdit();
  const [invoices, setInvoices] = useState<InvoiceDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<InvoiceDto['status'] | undefined>();
  const [clientId, setClientId] = useState<number | undefined>();
  const [period, setPeriod] = useState<Dayjs | null>(null);
  const [clients, setClients] = useState<ClientDto[]>([]);
  const [selected, setSelected] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const query = new URLSearchParams();
    if (status) query.set('status', status);
    if (clientId) query.set('clientId', String(clientId));
    if (period) query.set('period', period.format('YYYY-MM'));
    try {
      setInvoices(await api.get<InvoiceDto[]>(`/invoices${query.size ? `?${query}` : ''}`));
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [message, status, clientId, period]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .get<ClientDto[]>('/clients')
      .then(setClients)
      .catch(() => setClients([]));
  }, []);

  return (
    <>
      <Typography.Title level={3}>Facturas</Typography.Title>
      <BillingCard onFinished={load} />
      <Toolbar>
        <Select<InvoiceDto['status']>
          aria-label="Filtrar por estado"
          allowClear
          placeholder="Todos los estados"
          style={{ minWidth: 200 }}
          value={status}
          onChange={setStatus}
          options={Object.entries(INVOICE_STATUS_TAGS).map(([value, tag]) => ({
            value: value as InvoiceDto['status'],
            label: tag.label,
          }))}
        />
        <Select<number>
          aria-label="Filtrar por cliente"
          allowClear
          placeholder="Todos los clientes"
          style={{ minWidth: 240 }}
          value={clientId}
          onChange={setClientId}
          showSearch={{ optionFilterProp: 'label' }}
          options={clients.map((client) => ({ value: client.id, label: client.businessName }))}
        />
        <DatePicker
          aria-label="Filtrar por período"
          picker="month"
          format="MM/YYYY"
          placeholder="Todos los períodos"
          value={period}
          onChange={setPeriod}
        />
      </Toolbar>
      <Table<InvoiceDto>
        rowKey="id"
        loading={loading}
        dataSource={invoices}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        scroll={{ x: true }}
        locale={{
          emptyText: status || clientId || period ? 'Ninguna factura cumple los filtros.' : 'Todavía no hay facturas.',
        }}
        onRow={(invoice) => ({ onClick: () => setSelected(invoice.id), style: { cursor: 'pointer' } })}
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
          {
            title: 'Acciones',
            key: 'acciones',
            align: 'center' as const,
            width: 100,
            render: (_: unknown, invoice: InvoiceDto) => (
              <Space size={4}>
                {/* RF-162: cualquier perfil descarga el PDF. */}
                <span onClick={(e) => e.stopPropagation()}>
                  <Tooltip title="Descargar PDF">
                    <Button
                      type="text"
                      size="small"
                      icon={<FilePdfOutlined />}
                      aria-label="Descargar PDF"
                      href={`/api/invoices/${invoice.id}/pdf`}
                    />
                  </Tooltip>
                </span>
                {/* RF-147: un Admin o Editor pasa a Pagada una factura Pendiente de pago. */}
                {canEdit && invoice.status === 'pendiente_de_pago' && (
                  <TableAction
                    label="Pasar a Pagada"
                    icon={<CheckCircleOutlined />}
                    confirm="¿Pasar la factura a Pagada?"
                    confirmDescription="Deja de contar como deuda del cliente."
                    onClick={() => changeInvoiceStatus(message, invoice, 'pagada', load)}
                  />
                )}
              </Space>
            ),
          },
        ]}
      />
      {selected !== null && <InvoiceDetail invoiceId={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
