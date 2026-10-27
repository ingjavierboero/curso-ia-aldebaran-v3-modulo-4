import { StopOutlined, ThunderboltOutlined, UndoOutlined } from '@ant-design/icons';
import type { BillingStatusDto, SettingsDto } from '@api-types';
import { App, Button, Card, Popconfirm, Space, Tag, Tooltip, Typography } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import { errorMessage } from '../../forms.ts';
import { formatPeriodLong } from '../../format.ts';
import { useSessionStore } from '../../stores/session.ts';

type Status = BillingStatusDto['status'];

const STATUS_TAGS: Record<Status, { color: string; label: string }> = {
  pendiente: { color: 'default', label: 'Pendiente' },
  en_curso: { color: 'processing', label: 'En curso' },
  completado: { color: 'green', label: 'Realizada' },
  cancelado: { color: 'red', label: 'Cancelada' },
};

/** Mientras se factura, el estado se vuelve a consultar cada 3 segundos. */
const POLL_MS = 3_000;

function describe(status: Status, billingTime: string | null): string {
  switch (status) {
    case 'pendiente':
      return billingTime
        ? `Se factura automáticamente el día 15 a las ${billingTime}.`
        : 'Se factura automáticamente el día 15 a la hora de facturación configurada.';
    case 'en_curso':
      return 'Facturando…';
    case 'completado':
      return 'La facturación del mes ya se realizó.';
    case 'cancelado':
      return 'La facturación del mes está cancelada: no se va a facturar salvo que se reactive.';
  }
}

/**
 * Estado de la facturación del mes en curso y acciones del Admin: "Facturar ahora", cancelar y reactivar
 * (RF-54 a RF-61). Avisa con `onFinished` cuando termina una corrida, para recargar el listado.
 */
export function BillingCard({ onFinished }: { onFinished: () => void }) {
  const isAdmin = useSessionStore((state) => state.user?.role === 'admin');
  const { message } = App.useApp();
  const [billing, setBilling] = useState<BillingStatusDto | null>(null);
  const [billingTime, setBillingTime] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const previous = useRef<Status | null>(null);

  const refresh = useCallback(async () => {
    try {
      setBilling(await api.get<BillingStatusDto>('/billing/current'));
    } catch (e) {
      message.error(errorMessage(e));
    }
  }, [message]);

  useEffect(() => {
    void refresh();
    api
      .get<SettingsDto>('/settings')
      .then((settings) => setBillingTime(settings.billingTime))
      .catch(() => setBillingTime(null));
  }, [refresh]);

  // Mientras factura, consulta el estado; cuando termina, avisa y recarga el listado.
  useEffect(() => {
    const before = previous.current;
    previous.current = billing?.status ?? null;
    if (before === 'en_curso' && billing?.status === 'completado') {
      message.success('Facturación del mes terminada.');
      onFinished();
    }
    if (billing?.status !== 'en_curso') return undefined;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [billing?.status, refresh, onFinished, message]);

  async function act(path: string, success: string) {
    setBusy(true);
    try {
      setBilling(await api.post<BillingStatusDto>(path));
      message.success(success);
    } catch (e) {
      message.error(errorMessage(e)); // por ejemplo, otro usuario ya facturó (409)
      void refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!billing) return <Card loading style={{ marginBottom: 16 }} />;

  const tag = STATUS_TAGS[billing.status];
  const reason = billing.billNow.reason;

  return (
    <Card
      style={{ marginBottom: 16 }}
      title={
        <Space>
          <span>Facturación de {formatPeriodLong(billing.period)}</span>
          <Tag color={tag.color}>{tag.label}</Tag>
        </Space>
      }
      extra={
        isAdmin && (
          <Space wrap>
            {billing.status === 'pendiente' && (
              <Popconfirm
                title="¿Cancelar la facturación de este mes?"
                description="El día 15 no se va a facturar."
                okText="Sí, cancelar"
                cancelText="No"
                onConfirm={() => act('/billing/current/cancel', 'Facturación del mes cancelada.')}
              >
                <Button icon={<StopOutlined />} danger loading={busy}>
                  Cancelar el mes
                </Button>
              </Popconfirm>
            )}
            {billing.status === 'cancelado' && (
              <Button
                icon={<UndoOutlined />}
                loading={busy}
                onClick={() => act('/billing/current/reactivate', 'Facturación del mes reactivada.')}
              >
                Reactivar el mes
              </Button>
            )}
            <Tooltip title={reason}>
              <Popconfirm
                title="¿Facturar ahora el mes en curso?"
                description="Se genera y se envía la factura de cada cliente Activo con productos Activos."
                okText="Facturar"
                cancelText="No"
                disabled={!billing.billNow.enabled}
                onConfirm={() => act('/billing/current/bill-now', 'Facturación iniciada.')}
              >
                <Button
                  type="primary"
                  icon={<ThunderboltOutlined />}
                  disabled={!billing.billNow.enabled}
                  loading={busy}
                >
                  Facturar ahora
                </Button>
              </Popconfirm>
            </Tooltip>
          </Space>
        )
      }
    >
      <Typography.Text type="secondary">{describe(billing.status, billingTime)}</Typography.Text>
      {isAdmin && reason && (
        <div>
          <Typography.Text type="secondary">"Facturar ahora" está deshabilitado: {reason}.</Typography.Text>
        </div>
      )}
    </Card>
  );
}
