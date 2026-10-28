import type { ClientDto, ResolvedPaymentDto } from '@api-types';
import { App, DatePicker, Select, Table, Tag, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { api } from '../../api/client.ts';
import { EmailList } from '../../components/EmailCard.tsx';
import { errorMessage } from '../../forms.ts';
import { formatDateTime, formatPeriod } from '../../format.ts';
import { INVOICE_STATUS_TAGS } from '../invoices/InvoicesPage.tsx';

const Toolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
`;

const DECISIONS: Record<ResolvedPaymentDto['decision'], { color: string; label: string }> = {
  pagada: { color: 'green', label: 'Pagada' },
  pendiente_de_pago: { color: 'gold', label: 'Devuelta a Pendiente de pago' },
};

/**
 * Decisiones de los usuarios sobre los pagos a revisar, de la más reciente a la más antigua, filtrables por
 * cliente y por rango de fechas de la decisión (RF-216).
 */
export function ResolvedTab() {
  const { message } = App.useApp();
  const [resolved, setResolved] = useState<ResolvedPaymentDto[]>([]);
  const [clients, setClients] = useState<ClientDto[]>([]);
  const [clientId, setClientId] = useState<number | undefined>();
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const query = new URLSearchParams();
    if (clientId) query.set('clientId', String(clientId));
    if (range?.[0]) query.set('from', range[0].format('YYYY-MM-DD'));
    if (range?.[1]) query.set('to', range[1].format('YYYY-MM-DD'));
    try {
      setResolved(await api.get<ResolvedPaymentDto[]>(`/review/resolved${query.size ? `?${query}` : ''}`));
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [clientId, range, message]);

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
      <Toolbar>
        <Select<number>
          allowClear
          placeholder="Todos los clientes"
          style={{ minWidth: 240 }}
          value={clientId}
          onChange={setClientId}
          showSearch={{ optionFilterProp: 'label' }}
          options={clients.map((client) => ({ value: client.id, label: client.businessName }))}
        />
        <DatePicker.RangePicker format="DD/MM/YYYY" value={range} onChange={(value) => setRange(value)} />
      </Toolbar>
      <Table<ResolvedPaymentDto>
        rowKey={(row) => `${row.invoice.id}-${row.decidedAt}`}
        loading={loading}
        dataSource={resolved}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        scroll={{ x: true }}
        locale={{ emptyText: 'No hay decisiones que coincidan con el filtro.' }}
        expandable={{ expandedRowRender: (row) => <EmailList emails={row.emails} /> }}
        columns={[
          {
            title: 'Factura',
            key: 'numero',
            render: (_, { invoice }) => <span style={{ whiteSpace: 'nowrap' }}>{invoice.voucherNumber}</span>,
          },
          { title: 'Cliente', key: 'cliente', render: (_, { invoice }) => invoice.clientName },
          { title: 'Período', key: 'periodo', render: (_, { invoice }) => formatPeriod(invoice.period) },
          {
            title: 'Decisión',
            dataIndex: 'decision',
            render: (decision: ResolvedPaymentDto['decision']) => (
              <Tag color={DECISIONS[decision].color}>{DECISIONS[decision].label}</Tag>
            ),
          },
          { title: 'Usuario', key: 'usuario', render: (_, row) => row.decidedBy.name },
          {
            title: 'Fecha',
            dataIndex: 'decidedAt',
            render: (at: string) => <span style={{ whiteSpace: 'nowrap' }}>{formatDateTime(at)}</span>,
          },
          {
            title: 'Estado anterior',
            dataIndex: 'previousStatus',
            render: (previous: ResolvedPaymentDto['previousStatus']) => INVOICE_STATUS_TAGS[previous].label,
          },
          {
            title: 'Motivo anterior',
            dataIndex: 'previousReason',
            render: (reason: string | null) => reason && <Typography.Text type="secondary">{reason}</Typography.Text>,
          },
        ]}
      />
    </>
  );
}
