import { ISSUER_IVA_CONDITIONS, type SettingsDto } from '@api-types';
import { Alert, Button, Card, DatePicker, Form, Input, InputNumber, Select, Spin, TimePicker, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import { errorMessage } from '../forms.ts';
import { useSessionStore } from '../stores/session.ts';

/** Valores del formulario: las horas y la fecha van como Dayjs para los selectores de antd. */
type SettingsForm = Omit<SettingsDto, 'issuerCuit' | 'billingTime' | 'remindersTime' | 'issuerActivityStartDate'> & {
  billingTime: Dayjs | null;
  remindersTime: Dayjs | null;
  issuerActivityStartDate: Dayjs | null;
};

type SettingsUpdate = Partial<Omit<SettingsDto, 'issuerCuit'>>;

const TIME_FORMAT = 'HH:mm';
const DATE_FORMAT = 'YYYY-MM-DD';

const TIME_RULES = [{ required: true, message: 'La hora es obligatoria.' }];

/** `HH:MM` → Dayjs de hoy a esa hora (sin el plugin de parseo con formato de dayjs). */
function parseTime(value: string): Dayjs {
  const [hour = 0, minute = 0] = value.split(':').map(Number);
  return dayjs().hour(hour).minute(minute).second(0).millisecond(0);
}

function toForm(settings: SettingsDto): SettingsForm {
  return {
    ...settings,
    billingTime: parseTime(settings.billingTime),
    remindersTime: parseTime(settings.remindersTime),
    issuerActivityStartDate: settings.issuerActivityStartDate ? dayjs(settings.issuerActivityStartDate) : null,
  };
}

const IVA_OPTIONS = ISSUER_IVA_CONDITIONS.map((value) => ({ value, label: value }));

const TEXT_FIELDS = ['issuerBusinessName', 'issuerAddress', 'issuerIvaCondition', 'issuerGrossIncomeNumber'] as const;

const NUMBER_FIELDS = ['mailboxIntervalMinutes', 'retryCount', 'retryWaitMinutes', 'pointOfSale'] as const;

/**
 * Arma el cambio a enviar, con las horas en `HH:MM` y la fecha en `YYYY-MM-DD`. Los datos del emisor
 * que nunca se cargaron y siguen vacíos no se envían
 * (el server los rechazaría por vacíos), un número borrado conserva el valor guardado y el nombre de
 * fantasía vacío se quita (RF-215).
 */
function toUpdate(values: SettingsForm, current: SettingsDto): SettingsUpdate {
  const { billingTime, remindersTime, issuerActivityStartDate, ...rest } = values;
  const update: SettingsUpdate = { ...rest };
  if (billingTime) update.billingTime = billingTime.format(TIME_FORMAT);
  if (remindersTime) update.remindersTime = remindersTime.format(TIME_FORMAT);
  if (issuerActivityStartDate) update.issuerActivityStartDate = issuerActivityStartDate.format(DATE_FORMAT);
  for (const field of TEXT_FIELDS) {
    if (!values[field] && current[field] === null) delete update[field];
  }
  for (const field of NUMBER_FIELDS) {
    if (values[field] === null || values[field] === undefined) delete update[field];
  }
  update.issuerTradeName = values.issuerTradeName?.trim() ? values.issuerTradeName : null;
  return update;
}

/**
 * Configuración de los procesos, el punto de venta y los datos de la empresa emisora (RF-62, RF-73,
 * RF-91, RF-100, RF-152, RF-172, RF-173). Todos la ven; solo un Admin la modifica (RF-09 a RF-11).
 */
export function SettingsPage() {
  const user = useSessionStore((state) => state.user);
  const canEdit = user?.role === 'admin';
  const [form] = Form.useForm<SettingsForm>();
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [result, setResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<SettingsDto>('/settings')
      .then(setSettings)
      .catch((e) => setResult({ type: 'error', text: errorMessage(e) }));
  }, []);

  async function submit(values: SettingsForm) {
    if (!settings) return;
    setSaving(true);
    setResult(null);
    try {
      const saved = await api.put<SettingsDto>('/settings', toUpdate(values, settings));
      setSettings(saved);
      form.setFieldsValue(toForm(saved));
      setResult({ type: 'success', text: 'La configuración se guardó.' });
    } catch (e) {
      setResult({ type: 'error', text: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    if (result) return <Alert type="error" title={result.text} />;
    return <Spin style={{ display: 'block', margin: '48px auto' }} />;
  }

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        Configuración
      </Typography.Title>
      {!canEdit && <Alert type="info" title="Solo un Admin puede modificar la configuración." />}
      {result && <Alert type={result.type} title={result.text} closable onClose={() => setResult(null)} />}
      <Form<SettingsForm>
        form={form}
        layout="vertical"
        requiredMark={false}
        disabled={!canEdit}
        initialValues={toForm(settings)}
        onFinish={submit}
      >
        <Card title="Procesos automáticos" style={{ marginBottom: 16 }}>
          <Form.Item label="Intervalo de revisión de la casilla (minutos)" name="mailboxIntervalMinutes">
            <InputNumber min={5} max={60} precision={0} />
          </Form.Item>
          <Form.Item label="Hora de facturación" name="billingTime" rules={TIME_RULES}>
            <TimePicker format={TIME_FORMAT} needConfirm={false} placeholder="HH:MM" />
          </Form.Item>
          <Form.Item label="Hora de recordatorios" name="remindersTime" rules={TIME_RULES}>
            <TimePicker format={TIME_FORMAT} needConfirm={false} placeholder="HH:MM" />
          </Form.Item>
          <Form.Item label="Cantidad de reintentos" name="retryCount">
            <InputNumber min={0} max={10} precision={0} />
          </Form.Item>
          <Form.Item label="Espera entre reintentos (minutos)" name="retryWaitMinutes">
            <InputNumber min={1} max={60} precision={0} />
          </Form.Item>
        </Card>
        <Card title="Empresa emisora y ARCA" style={{ marginBottom: 16 }}>
          <Form.Item label="CUIT" extra="Sale de la variable de entorno ARCA_CUIT.">
            <Input value={settings.issuerCuit} disabled />
          </Form.Item>
          <Form.Item label="Punto de venta" name="pointOfSale">
            <InputNumber min={1} max={99999} precision={0} />
          </Form.Item>
          <Form.Item label="Razón social" name="issuerBusinessName">
            <Input />
          </Form.Item>
          <Form.Item label="Nombre de fantasía (opcional)" name="issuerTradeName">
            <Input />
          </Form.Item>
          <Form.Item label="Domicilio comercial" name="issuerAddress">
            <Input />
          </Form.Item>
          <Form.Item label="Condición frente al IVA" name="issuerIvaCondition">
            <Select options={IVA_OPTIONS} placeholder="Elegí la condición" />
          </Form.Item>
          <Form.Item label="Número de ingresos brutos" name="issuerGrossIncomeNumber">
            <Input />
          </Form.Item>
          <Form.Item label="Fecha de inicio de actividades" name="issuerActivityStartDate">
            <DatePicker format="DD/MM/YYYY" placeholder="DD/MM/AAAA" />
          </Form.Item>
        </Card>
        {canEdit && (
          <Button type="primary" htmlType="submit" loading={saving}>
            Guardar
          </Button>
        )}
      </Form>
    </div>
  );
}
