import {
  CLIENT_IVA_CODES,
  CLIENT_IVA_CONDITIONS,
  type ClientDto,
  type ClientInput,
  type ClientIvaCondition,
} from '@api-types';
import { Alert, Form, Input, Modal, Select } from 'antd';
import { useState } from 'react';
import { emailRules, errorMessage } from '../../forms.ts';

export const IVA_OPTIONS = CLIENT_IVA_CODES.map((code) => ({ value: code, label: CLIENT_IVA_CONDITIONS[code] }));

/** Nombre de la condición frente al IVA de un cliente (RF-38). */
export const ivaConditionLabel = (code: ClientIvaCondition) => CLIENT_IVA_CONDITIONS[code];

const required = (label: string) => [{ required: true, whitespace: true, message: `${label} es obligatorio.` }];

/** RF-39: 11 dígitos, con o sin guiones; el dígito verificador lo valida el server. */
const CUIT_RULES = [
  { required: true, message: 'El CUIT es obligatorio.' },
  {
    validator: (_: unknown, value?: string) =>
      !value || /^\d{11}$/.test(value.replace(/[\s.-]/g, ''))
        ? Promise.resolve()
        : Promise.reject(new Error('El CUIT tiene que tener 11 dígitos.')),
  },
];

/**
 * Alta o modificación de un cliente en un modal (RF-34, RF-35). `onSubmit` llama a la API; si falla,
 * el error (CUIT inválido o repetido, email repetido) se muestra en el modal.
 */
export function ClientForm({
  client,
  onSubmit,
  onClose,
}: {
  client: ClientDto | null;
  onSubmit: (input: ClientInput) => Promise<void>;
  onClose: () => void;
}) {
  const [form] = Form.useForm<ClientInput>();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(values: ClientInput) {
    setSaving(true);
    setError(null);
    try {
      await onSubmit(values);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={client ? 'Modificar cliente' : 'Nuevo cliente'}
      okText="Guardar"
      cancelText="Cancelar"
      confirmLoading={saving}
      onOk={() => form.submit()}
      onCancel={onClose}
      destroyOnHidden
    >
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
      <Form<ClientInput>
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={client ?? undefined}
        onFinish={submit}
      >
        <Form.Item label="Razón social" name="businessName" rules={required('La razón social')}>
          <Input />
        </Form.Item>
        <Form.Item label="CUIT" name="cuit" rules={CUIT_RULES}>
          <Input placeholder="20-12345678-9" />
        </Form.Item>
        <Form.Item label="Domicilio" name="address" rules={required('El domicilio')}>
          <Input />
        </Form.Item>
        <Form.Item label="Email de facturación" name="billingEmail" rules={emailRules}>
          <Input type="email" />
        </Form.Item>
        <Form.Item
          label="Condición frente al IVA"
          name="ivaCondition"
          rules={[{ required: true, message: 'La condición frente al IVA es obligatoria.' }]}
        >
          <Select
            options={IVA_OPTIONS}
            placeholder="Elegí una condición"
            showSearch={{ optionFilterProp: 'label' }}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
