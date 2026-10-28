import { DownloadOutlined } from '@ant-design/icons';
import type { BillingReportRow, CollectionsReportRow, DebtReportRow } from '@api-types';
import { App, Button, DatePicker, Table, Tabs, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import styled from 'styled-components';
import { api } from '../api/client.ts';
import { errorMessage } from '../forms.ts';
import { formatDate, formatMoney, formatPeriod } from '../format.ts';
import { INVOICE_STATUS_TAGS } from './invoices/InvoicesPage.tsx';

const Toolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin-bottom: 16px;
`;

type ReportKey = 'billing' | 'collections' | 'debt';

/** Una fila del reporte de deuda por factura adeudada, como en el CSV (AC-174). */
type DebtRow = DebtReportRow['invoices'][number] & { businessName: string; debtCents: number };

const money = (cents: number) => <span style={{ whiteSpace: 'nowrap' }}>{formatMoney(cents, 'ARS')}</span>;
const periodColumn = { title: 'Período', dataIndex: 'period', render: (p: string) => formatPeriod(p) };

const BILLING_COLUMNS: ColumnsType<BillingReportRow> = [
  periodColumn,
  { title: 'Facturas emitidas', dataIndex: 'invoiceCount', align: 'right' },
  { title: 'Total facturado', dataIndex: 'totalCents', align: 'right', render: money },
];

const COLLECTIONS_COLUMNS: ColumnsType<CollectionsReportRow> = [
  periodColumn,
  { title: 'Total facturado', dataIndex: 'totalCents', align: 'right', render: money },
  { title: 'Pagada', dataIndex: 'paidCents', align: 'right', render: money },
  { title: 'Pago recibido', dataIndex: 'paymentReceivedCents', align: 'right', render: money },
  { title: 'Adeudada', dataIndex: 'owedCents', align: 'right', render: money },
];

const DEBT_COLUMNS: ColumnsType<DebtRow> = [
  { title: 'Cliente', dataIndex: 'businessName' },
  { title: 'Deuda vigente', dataIndex: 'debtCents', align: 'right', render: money },
  {
    title: 'Factura',
    dataIndex: 'voucherNumber',
    render: (n: string | null) => <span style={{ whiteSpace: 'nowrap' }}>{n}</span>,
  },
  periodColumn,
  { title: 'Importe', dataIndex: 'totalCents', align: 'right', render: money },
  { title: 'Vencimiento', dataIndex: 'dueDate', render: (d: string) => formatDate(d) },
  {
    title: 'Estado',
    dataIndex: 'status',
    render: (status: DebtRow['status']) => (
      <Tag color={INVOICE_STATUS_TAGS[status].color}>{INVOICE_STATUS_TAGS[status].label}</Tag>
    ),
  },
];

/** Dirección del reporte con sus filtros; con `csv`, la de su descarga (RF-167). */
function reportUrl(report: ReportKey, range: [Dayjs | null, Dayjs | null] | null, csv = false): string {
  const query = new URLSearchParams();
  if (report !== 'debt' && range?.[0]) query.set('from', range[0].format('YYYY-MM'));
  if (report !== 'debt' && range?.[1]) query.set('to', range[1].format('YYYY-MM'));
  if (csv) query.set('format', 'csv');
  return `/reports/${report}${query.size ? `?${query}` : ''}`;
}

/**
 * Reportes de facturación y cobranza por período, filtrables por un rango (RF-164, RF-165, RF-170), y de
 * deuda por cliente (RF-166). Cada uno se descarga como CSV con las mismas filas y columnas (RF-167).
 */
export function ReportsPage() {
  const { message } = App.useApp();
  const [params, setParams] = useSearchParams();
  const report = (params.get('reporte') as ReportKey | null) ?? 'billing';
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  // Las filas guardan de qué reporte son: al cambiar de pestaña no se muestran con las columnas de otro.
  const [data, setData] = useState<{ report: ReportKey; rows: unknown[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let current = true;
    setLoading(true);
    api
      .get<unknown[]>(reportUrl(report, range))
      .then((response) => {
        if (!current) return;
        const rows =
          report === 'debt'
            ? (response as DebtReportRow[]).flatMap((client) =>
                client.invoices.map((invoice) => ({
                  ...invoice,
                  businessName: client.businessName,
                  debtCents: client.debtCents,
                })),
              )
            : response;
        setData({ report, rows });
      })
      .catch((e) => current && message.error(errorMessage(e)))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [report, range, message]);

  const rows = data?.report === report ? data.rows : [];
  const table = (() => {
    const common = {
      loading: loading || data?.report !== report,
      pagination: { pageSize: 50, hideOnSinglePage: true },
      scroll: { x: true as const },
      locale: { emptyText: 'No hay datos para este reporte.' },
    };
    if (report === 'billing') {
      return (
        <Table<BillingReportRow>
          {...common}
          rowKey="period"
          columns={BILLING_COLUMNS}
          dataSource={rows as BillingReportRow[]}
        />
      );
    }
    if (report === 'collections') {
      return (
        <Table<CollectionsReportRow>
          {...common}
          rowKey="period"
          columns={COLLECTIONS_COLUMNS}
          dataSource={rows as CollectionsReportRow[]}
        />
      );
    }
    return <Table<DebtRow> {...common} rowKey="invoiceId" columns={DEBT_COLUMNS} dataSource={rows as DebtRow[]} />;
  })();

  return (
    <>
      <Typography.Title level={3}>Reportes</Typography.Title>
      <Tabs
        activeKey={report}
        onChange={(key) => setParams({ reporte: key }, { replace: true })}
        items={[
          { key: 'billing', label: 'Facturación' },
          { key: 'collections', label: 'Cobranza' },
          { key: 'debt', label: 'Deuda por cliente' },
        ]}
      />
      <Toolbar>
        {report !== 'debt' && (
          <DatePicker.RangePicker
            picker="month"
            format="MM/YYYY"
            placeholder={['Desde', 'Hasta']}
            allowEmpty={[true, true]}
            value={range}
            onChange={(value) => setRange(value)}
          />
        )}
        <Button
          icon={<DownloadOutlined />}
          href={`/api${reportUrl(report, range, true)}`}
          style={{ marginInlineStart: 'auto' }}
        >
          Descargar CSV
        </Button>
      </Toolbar>
      {table}
    </>
  );
}
