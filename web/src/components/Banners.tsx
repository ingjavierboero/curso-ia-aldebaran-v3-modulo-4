import type { DashboardDto } from '@api-types';
import { Alert, App, Button, Space } from 'antd';
import { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import { errorMessage } from '../forms.ts';
import { useCanEdit } from '../stores/session.ts';

/**
 * Banners del dashboard: certificado de ARCA (RF-97, RF-98) y cotización de respaldo (RF-69), que un
 * Admin o Editor confirma desde el banner (RF-70).
 */
export function Banners() {
  const canEdit = useCanEdit();
  const { message } = App.useApp();
  const [banners, setBanners] = useState<DashboardDto['banners'] | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    api
      .get<DashboardDto>('/dashboard')
      .then((dashboard) => setBanners(dashboard.banners))
      .catch(() => setBanners(null));
  }, []);

  async function confirmRate() {
    setConfirming(true);
    try {
      setBanners((await api.post<DashboardDto>('/dashboard/exchange-rate/confirm')).banners);
      message.success('Cotización confirmada.');
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setConfirming(false);
    }
  }

  if (!banners || (!banners.certificate && !banners.exchangeRate)) return null;
  const { certificate, exchangeRate } = banners;

  return (
    <Space orientation="vertical" style={{ width: '100%', marginBottom: 16 }}>
      {certificate && (
        <Alert type={certificate.status === 'por_vencer' ? 'warning' : 'error'} showIcon title={certificate.message} />
      )}
      {exchangeRate && (
        <Alert
          type="warning"
          showIcon
          title={exchangeRate.message}
          action={
            canEdit && (
              <Button size="small" loading={confirming} onClick={confirmRate}>
                Confirmar
              </Button>
            )
          }
        />
      )}
    </Space>
  );
}
