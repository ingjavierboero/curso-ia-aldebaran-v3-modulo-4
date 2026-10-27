import type { Currency, ProductDto, ProductInput } from '@api-types';
import { Alert, Form, Input, InputNumber, Modal, Segmented } from 'antd';
import { useState } from 'react';
import { errorMessage } from '../../forms.ts';

/** En el formulario el precio va en pesos o dólares; a la API viaja en centavos (RNF-13). */
interface ProductFormValues {
  name: string;
  currency: Currency;
  price: number | null;
}

export const CURRENCY_LABELS: Record<Currency, string> = { ARS: 'Pesos', USD: 'Dólares' };

const CURRENCY_OPTIONS = (Object.keys(CURRENCY_LABELS) as Currency[]).map((value) => ({
  value,
  label: CURRENCY_LABELS[value],
}));

const AMOUNT = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** RF-44: la cuota mensual es obligatoria y mayor a cero. */
const PRICE_RULES = [
  { required: true, message: 'La cuota mensual es obligatoria.' },
  {
    validator: (_: unknown, value: number | null) =>
      value === null || value === undefined || value > 0
        ? Promise.resolve()
        : Promise.reject(new Error('La cuota mensual debe ser mayor a cero.')),
  },
];

/**
 * Alta o modificación de un producto en un modal (RF-42 a RF-46). El precio se carga con coma decimal
 * ("150,50") y se envía en centavos; si la API rechaza el cambio, el error se muestra en el modal.
 */
export function ProductForm({
  product,
  onSubmit,
  onClose,
}: {
  product: ProductDto | null;
  onSubmit: (input: ProductInput) => Promise<void>;
  onClose: () => void;
}) {
  const [form] = Form.useForm<ProductFormValues>();
  const currency = Form.useWatch('currency', form) ?? product?.currency ?? 'ARS';
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(values: ProductFormValues) {
    setSaving(true);
    setError(null);
    try {
      const priceCents = Math.round((values.price ?? 0) * 100);
      await onSubmit({ name: values.name, priceCents, currency: values.currency });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const initialValues: ProductFormValues = product
    ? { name: product.name, currency: product.currency, price: product.priceCents / 100 }
    : { name: '', currency: 'ARS', price: null };

  return (
    <Modal
      open
      title={product ? 'Modificar producto' : 'Nuevo producto'}
      okText="Guardar"
      cancelText="Cancelar"
      confirmLoading={saving}
      onOk={() => form.submit()}
      onCancel={onClose}
      destroyOnHidden
    >
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
      <Form<ProductFormValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={initialValues}
        onFinish={submit}
      >
        <Form.Item
          label="Nombre"
          name="name"
          rules={[{ required: true, whitespace: true, message: 'El nombre es obligatorio.' }]}
        >
          <Input />
        </Form.Item>
        <Form.Item label="Moneda" name="currency">
          <Segmented<Currency> options={CURRENCY_OPTIONS} />
        </Form.Item>
        <Form.Item label="Cuota mensual" name="price" rules={PRICE_RULES}>
          <InputNumber<number>
            prefix={currency === 'USD' ? 'US$' : '$'}
            precision={2}
            decimalSeparator=","
            // Mientras se escribe se muestra lo tipeado; si no, el monto con separadores de Argentina.
            formatter={(value, info) => {
              if (info.userTyping) return info.input;
              // Un campo vacío llega sin valor o como texto vacío: se deja vacío, no "0,00".
              return value === undefined || String(value) === '' ? '' : AMOUNT.format(Number(value));
            }}
            parser={(text) => Number((text ?? '').replace(/\./g, '').replace(',', '.'))}
            placeholder="0,00"
            style={{ width: '100%' }}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
