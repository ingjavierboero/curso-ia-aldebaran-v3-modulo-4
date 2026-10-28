import { FilePdfOutlined } from '@ant-design/icons';
import type { InvoiceDetailDto } from '@api-types';
import { Alert, Button, Descriptions, Drawer, Space, Spin, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { ActivityList } from '../../components/ActivityList.tsx';
import { EmailList } from '../../components/EmailCard.tsx';
import { errorMessage } from '../../forms.ts';
import { formatDate, formatMoney, formatPeriod } from '../../format.ts';
import { INVOICE_STATUS_TAGS } from './InvoicesPage.tsx';

const statusLabel = (status: string) =>
  status === 'generando' ? 'Generando' : INVOICE_STATUS_TAGS[status as keyof typeof INVOICE_STATUS_TAGS].label;

/**
 * Detalle de una factura (RF-217): sus datos, cada cuota, la descarga del PDF, los cambios de estado en
 * orden con quién los originó y los emails asociados con lo que el LLM extrajo de cada adjunto.
 */
export function InvoiceDetail({ invoiceId, onClose }: { invoiceId: number; onClose: () => void }) {
  const [detail, setDetail] = useState<InvoiceDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<InvoiceDetailDto>(`/invoices/${invoiceId}`)
      .then(setDetail)
      .catch((e) => setError(errorMessage(e)));
  }, [invoiceId]);

  const invoice = detail?.invoice;
  return (
    <Drawer
      open
      size="large"
      title={invoice ? `Factura C ${invoice.voucherNumber}` : 'Factura'}
      onClose={onClose}
      extra={
        detail && (
          <Button icon={<FilePdfOutlined />} href={detail.pdfUrl}>
            Descargar PDF
          </Button>
        )
      }
    >
      {error && <Alert type="error" showIcon title={error} />}
      {!detail && !error && <Spin style={{ display: 'block', margin: '48px auto' }} />}
      {detail && invoice && (
        <Space orientation="vertical" size="large" style={{ width: '100%' }}>
          <Descriptions column={1} size="small">
            <Descriptions.Item label="Cliente">{invoice.clientName}</Descriptions.Item>
            <Descriptions.Item label="Período">{formatPeriod(invoice.period)}</Descriptions.Item>
            <Descriptions.Item label="Emisión">{formatDate(invoice.issueDate)}</Descriptions.Item>
            <Descriptions.Item label="Vencimiento">{formatDate(invoice.dueDate)}</Descriptions.Item>
            <Descriptions.Item label="Total">{formatMoney(invoice.totalCents, 'ARS')}</Descriptions.Item>
            <Descriptions.Item label="CAE">{invoice.cae}</Descriptions.Item>
            <Descriptions.Item label="Estado">
              <Tag color={INVOICE_STATUS_TAGS[invoice.status].color}>{INVOICE_STATUS_TAGS[invoice.status].label}</Tag>
            </Descriptions.Item>
          </Descriptions>

          <section>
            <Typography.Title level={5}>Cuotas</Typography.Title>
            {detail.items.map((item, index) => (
              <div key={index} style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                <span>
                  {item.originalCurrency === 'USD'
                    ? `${item.description} (${formatMoney(item.originalPriceCents, 'USD')})`
                    : item.description}
                </span>
                <span style={{ whiteSpace: 'nowrap' }}>{formatMoney(item.amountCents, 'ARS')}</span>
              </div>
            ))}
          </section>

          <section>
            <Typography.Title level={5}>Cambios de estado</Typography.Title>
            <ActivityList
              label="Cambios de estado"
              empty="Sin cambios de estado."
              items={detail.statusChanges.map((change, index) => ({
                key: index,
                at: change.changedAt,
                actor: change.actor,
                title: `${statusLabel(change.fromStatus)} → ${statusLabel(change.toStatus)}`,
                detail: change.reason,
              }))}
            />
          </section>

          <section>
            <Typography.Title level={5}>Emails asociados</Typography.Title>
            <EmailList emails={detail.emails} />
          </section>
        </Space>
      )}
    </Drawer>
  );
}
