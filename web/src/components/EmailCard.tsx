import { PaperClipOutlined } from '@ant-design/icons';
import type { ReceivedAttachmentDto, ReceivedEmailDto } from '@api-types';
import { Card, Space, Tag, Typography } from 'antd';
import { formatCuit, formatDateTime, formatMoney } from '../format.ts';

type Classification = NonNullable<ReceivedAttachmentDto['classification']>;

const CLASSIFICATION_TAGS: Record<Classification, { color: string; label: string }> = {
  si: { color: 'green', label: 'Comprobante' },
  no: { color: 'default', label: 'No es comprobante' },
  dudoso: { color: 'gold', label: 'Dudoso' },
  error: { color: 'red', label: 'Procesamiento erróneo' },
};

function ClassificationTag({ value }: { value: ReceivedAttachmentDto['classification'] }) {
  if (!value) return null;
  const tag = CLASSIFICATION_TAGS[value];
  return <Tag color={tag.color}>{tag.label}</Tag>;
}

/** Un adjunto con su resultado: el link se abre con la descarga segura de la API (RNF-16). */
function Attachment({ attachment }: { attachment: ReceivedAttachmentDto }) {
  return (
    <Space wrap size={8}>
      <a href={`/api/attachments/${attachment.id}`} target="_blank" rel="noopener noreferrer">
        <PaperClipOutlined aria-hidden /> {attachment.filename}
      </a>
      <ClassificationTag value={attachment.classification} />
      {attachment.classification === 'si' && (
        <Typography.Text type="secondary">
          CUIT {attachment.cuit ? formatCuit(attachment.cuit) : 'no extraído'} · Monto{' '}
          {attachment.amountCents !== null ? formatMoney(attachment.amountCents, 'ARS') : 'no extraído'}
        </Typography.Text>
      )}
      {attachment.error && <Typography.Text type="danger">{attachment.error}</Typography.Text>}
    </Space>
  );
}

/**
 * Un email recibido con sus adjuntos, la clasificación del LLM de cada uno y el CUIT y el monto extraídos
 * de cada comprobante (RF-141, RF-216).
 */
export function EmailCard({ email }: { email: ReceivedEmailDto }) {
  return (
    <Card
      size="small"
      title={
        <Space wrap size={4}>
          <span>{email.subject || '(sin asunto)'}</span>
          <Typography.Text type="secondary" style={{ fontWeight: 'normal' }}>
            · {email.from} · {formatDateTime(email.receivedAt)}
          </Typography.Text>
        </Space>
      }
      extra={<ClassificationTag value={email.classification} />}
    >
      <Space orientation="vertical" size={4}>
        {email.attachments.length === 0 && <Typography.Text type="secondary">Sin adjuntos.</Typography.Text>}
        {email.attachments.map((attachment) => (
          <Attachment key={attachment.id} attachment={attachment} />
        ))}
      </Space>
    </Card>
  );
}

/** Varios emails, uno debajo del otro. */
export function EmailList({ emails }: { emails: ReceivedEmailDto[] }) {
  if (emails.length === 0) return <Typography.Text type="secondary">Sin emails asociados.</Typography.Text>;
  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      {emails.map((email) => (
        <EmailCard key={email.id} email={email} />
      ))}
    </Space>
  );
}
