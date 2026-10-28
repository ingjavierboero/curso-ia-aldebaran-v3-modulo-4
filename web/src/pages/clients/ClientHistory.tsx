import type { ClientEventDto } from '@api-types';
import { Card } from 'antd';
import { useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { type Activity, ActivityList } from '../../components/ActivityList.tsx';
import { formatPeriod } from '../../format.ts';
import { INVOICE_STATUS_TAGS } from '../invoices/InvoicesPage.tsx';
import { OPERATION_LABELS } from '../review/ErrorsTab.tsx';

const FIELD_LABELS: Record<string, string> = {
  businessName: 'razón social',
  cuit: 'CUIT',
  address: 'domicilio',
  billingEmail: 'email de facturación',
  ivaCondition: 'condición frente al IVA',
};

const STATUS_LABELS: Record<string, string> = {
  generando: 'Generando',
  ...Object.fromEntries(Object.entries(INVOICE_STATUS_TAGS).map(([status, tag]) => [status, tag.label])),
};

type Operation = keyof typeof OPERATION_LABELS;

const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));
const join = (...parts: unknown[]) => parts.map(text).filter(Boolean).join(' · ');

const REMINDER_TITLES: Record<string, string> = {
  automatico: 'Recordatorio de fin de mes enviado',
  manual: 'Recordatorio manual enviado',
  reintento_manual: 'Recordatorio reenviado',
};

/** Qué pasó en cada evento del historial, a partir de su tipo y su detalle (PRD, "Historial del cliente"). */
function describe(event: ClientEventDto): Pick<Activity, 'title' | 'detail'> {
  const p = event.payload;
  switch (event.type) {
    case 'alta':
      return { title: 'Alta del cliente' };
    case 'modificacion': {
      const changes = Object.entries((p.changes ?? {}) as Record<string, { from: unknown; to: unknown }>);
      return {
        title: 'Modificación',
        detail: changes
          .map(([field, change]) => `${FIELD_LABELS[field] ?? field}: ${text(change.from)} → ${text(change.to)}`)
          .join('; '),
      };
    }
    case 'baja':
      return { title: 'Baja del cliente' };
    case 'reactivacion':
      return { title: 'Reactivación del cliente' };
    case 'producto_asignado':
      return { title: 'Producto asignado', detail: text(p.productName) };
    case 'producto_desasignado':
      return { title: 'Producto desasignado', detail: text(p.productName) };
    case 'factura_generada':
      return {
        title: 'Factura generada',
        detail: join(p.voucherNumber, p.period ? formatPeriod(String(p.period)) : null),
      };
    case 'email_enviado':
      return {
        title:
          p.kind === 'recordatorio' ? (REMINDER_TITLES[text(p.trigger)] ?? 'Recordatorio enviado') : 'Factura enviada',
        detail: join(p.to ? `a ${text(p.to)}` : null, p.subject),
      };
    case 'email_recibido':
      return { title: 'Email recibido', detail: text(p.subject) };
    case 'estado_factura':
      return {
        title: `${STATUS_LABELS[text(p.from)] ?? text(p.from)} → ${STATUS_LABELS[text(p.to)] ?? text(p.to)}`,
        detail: text(p.reason),
      };
    case 'error_proceso':
      return {
        title: `Error de proceso: ${OPERATION_LABELS[text(p.operation) as Operation] ?? text(p.operation)}`,
        detail: text(p.message),
      };
    case 'recordatorio_cancelado':
      return { title: 'Recordatorio cancelado', detail: text(p.reason) };
    default:
      return { title: event.type };
  }
}

/** Historial del cliente en orden cronológico, con quién originó cada evento (RF-163, AC-12). */
export function ClientHistory({ clientId }: { clientId: number }) {
  const [events, setEvents] = useState<ClientEventDto[] | null>(null);

  useEffect(() => {
    api
      .get<ClientEventDto[]>(`/clients/${clientId}/history`)
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [clientId]);

  return (
    <Card title="Historial" loading={events === null}>
      <ActivityList
        label="Historial del cliente"
        empty="Todavía no hay eventos."
        items={(events ?? []).map((event) => ({
          key: event.id,
          at: event.occurredAt,
          actor: event.actor,
          ...describe(event),
        }))}
      />
    </Card>
  );
}
