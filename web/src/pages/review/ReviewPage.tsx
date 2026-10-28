import type { NoticeDto, ProcessErrorDto, ReviewPaymentDto } from '@api-types';
import { App, Badge, Space, Tabs, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../../api/client.ts';
import { errorMessage } from '../../forms.ts';
import { useCanEdit } from '../../stores/session.ts';
import { ErrorsTab } from './ErrorsTab.tsx';
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
  const [errors, setErrors] = useState<ProcessErrorDto[]>([]);
  // La pestaña abierta va en la URL, así el banner de errores lleva directo a la suya (`?tab=errores`).
  const [params, setParams] = useSearchParams();
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

  const loadErrors = useCallback(async () => {
    try {
      setErrors(await api.get<ProcessErrorDto[]>('/review/errors'));
    } catch (e) {
      message.error(errorMessage(e));
    }
  }, [message]);

  useEffect(() => {
    void Promise.all([loadPayments(), loadNotices(), loadErrors()]).finally(() => setLoading(false));
  }, [loadPayments, loadNotices, loadErrors]);

  return (
    <>
      <Typography.Title level={3}>Revisión</Typography.Title>
      <Tabs
        activeKey={params.get('tab') ?? 'pagos'}
        onChange={(tab) => setParams({ tab }, { replace: true })}
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
            label: tabLabel('Errores', errors.length),
            children: <ErrorsTab errors={errors} loading={loading} canEdit={canEdit} reload={loadErrors} />,
          },
          { key: 'resueltos', label: 'Resueltos', children: <ResolvedTab /> },
        ]}
      />
    </>
  );
}
