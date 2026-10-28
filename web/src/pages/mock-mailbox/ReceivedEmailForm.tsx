import { UploadOutlined } from '@ant-design/icons';
import type { ClientDto } from '@api-types';
import { Alert, AutoComplete, Button, Form, Input, Modal, Upload, type UploadFile } from 'antd';
import { useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { emailRules, errorMessage } from '../../forms.ts';

/** Email recibido tal como lo espera `POST /api/mock-mailbox/received` (contracts/http-api.md). */
export interface ReceivedEmailInput {
  from: string;
  subject: string;
  body: string;
  attachments: Array<{ filename: string; mimeType: string; contentBase64: string }>;
}

interface FormValues {
  from: string;
  subject?: string;
  body?: string;
}

/** Contenido de un archivo en base64, sin el prefijo `data:...;base64,`. */
function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Carga de un email recibido en la casilla simulada (RF-200): remitente (sugiere los emails de
 * facturación de los clientes), asunto, cuerpo y adjuntos. Los adjuntos no se suben solos: se envían
 * junto con el email al confirmar.
 */
export function ReceivedEmailForm({
  onSubmit,
  onClose,
}: {
  onSubmit: (input: ReceivedEmailInput) => Promise<void>;
  onClose: () => void;
}) {
  const [form] = Form.useForm<FormValues>();
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [clientEmails, setClientEmails] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<ClientDto[]>('/clients')
      .then((clients) => setClientEmails(clients.map((client) => client.billingEmail)))
      .catch(() => setClientEmails([]));
  }, []);

  async function submit(values: FormValues) {
    setSaving(true);
    setError(null);
    try {
      const attachments = await Promise.all(
        files.map(async (file) => ({
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          contentBase64: await toBase64(file.originFileObj ?? (file as unknown as Blob)),
        })),
      );
      await onSubmit({ from: values.from, subject: values.subject ?? '', body: values.body ?? '', attachments });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title="Cargar email recibido"
      okText="Cargar"
      cancelText="Cancelar"
      confirmLoading={saving}
      onOk={() => form.submit()}
      onCancel={onClose}
      destroyOnHidden
    >
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
      <Form<FormValues> form={form} layout="vertical" requiredMark={false} onFinish={submit}>
        <Form.Item label="Remitente" name="from" rules={emailRules}>
          <AutoComplete
            options={clientEmails.map((email) => ({ value: email }))}
            showSearch={{ filterOption: (input, option) => String(option?.value).includes(input.toLowerCase()) }}
            placeholder="pagos@cliente.com"
          />
        </Form.Item>
        <Form.Item label="Asunto" name="subject">
          <Input />
        </Form.Item>
        <Form.Item label="Cuerpo" name="body">
          <Input.TextArea rows={4} />
        </Form.Item>
        <Form.Item label="Adjuntos" extra="Por ejemplo pago_30711111111_15000.50.pdf, dudoso_1.jpg o error_1.pdf.">
          <Upload
            multiple
            fileList={files}
            beforeUpload={(file) => {
              const added: UploadFile = { uid: file.uid, name: file.name, type: file.type, originFileObj: file };
              setFiles((current) => [...current, added]);
              return false;
            }}
            onRemove={(file) => setFiles((current) => current.filter((item) => item.uid !== file.uid))}
          >
            <Button icon={<UploadOutlined />}>Elegir archivos</Button>
          </Upload>
        </Form.Item>
      </Form>
    </Modal>
  );
}
