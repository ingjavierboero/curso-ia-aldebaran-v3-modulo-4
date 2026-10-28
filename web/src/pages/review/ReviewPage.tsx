import type { NoticeDto, ReviewPaymentDto } from '@api-types';
import { App, Badge, Empty, Space, Tabs, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { errorMessage } from '../../forms.ts';
import { useCanEdit } from '../../stores/session.ts';
import { NoticesTab } from './NoticesTab.tsx';
import { PaymentsTab } from './PaymentsTab.tsx';
import { ResolvedTab } from './ResolvedTab.tsx';

/** Título de una pestaña con la cantidad de pendientes. */
const tabLabel = (label: string, count: number) => (
  <Space size={6}>
    {label}
    <Badge count={count} showZero={false} />
  </Space>
);

/**
 * Interfaz de revisión: los pagos a revisar con su evidencia, los avisos, los errores de proceso y las
 * decisiones resueltas (RF-141 a RF-148, RF-216). Todos los perfiles la ven; Admin y Editor deciden.
 */
export function ReviewPage() {
  const canEdit = useCanEdit();
  const { message } = App.useApp();
  const [payments, setPayments] = useState<ReviewPaymentDto[]>([]);
  const [notices, setNotices] = useState<NoticeDto[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPayments = useCallback(async () => {
    try {
      setPayments(await api.get<ReviewPaymentDto[]>('/review/payments'));
    } catch (e) {
      message.error(errorMessage(e));
    }
  }, [message]);

  const loadNotices = useCallback(async () => {
    try {
      setNotices(await api.get<NoticeDto[]>('/review/notices'));
    } catch (e) {
      message.error(errorMessage(e));
    }
  }, [message]);

  useEffect(() => {
    void Promise.all([loadPayments(), loadNotices()]).finally(() => setLoading(false));
  }, [loadPayments, loadNotices]);

  return (
    <>
      <Typography.Title level={3}>Revisión</Typography.Title>
      <Tabs
        items={[
          {
            key: 'pagos',
            label: tabLabel('Pagos', payments.length),
            children: <PaymentsTab payments={payments} loading={loading} canEdit={canEdit} reload={loadPayments} />,
          },
          {
            key: 'avisos',
            label: tabLabel('Avisos', notices.length),
            children: <NoticesTab notices={notices} loading={loading} canEdit={canEdit} reload={loadNotices} />,
          },
          {
            key: 'errores',
            label: 'Errores',
            children: <Empty description="No hay errores de proceso pendientes." />,
          },
          { key: 'resueltos', label: 'Resueltos', children: <ResolvedTab /> },
        ]}
      />
    </>
  );
}
