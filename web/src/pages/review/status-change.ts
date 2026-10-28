import type { InvoiceStatus } from '@api-types';
import type { MessageInstance } from 'antd/es/message/interface';
import { ApiError, api } from '../../api/client.ts';
import { errorMessage } from '../../forms.ts';

const SUCCESS: Record<'pagada' | 'pendiente_de_pago', string> = {
  pagada: 'Factura pasada a Pagada.',
  pendiente_de_pago: 'Factura devuelta a Pendiente de pago.',
};

/**
 * Cambio de estado de una factura desde la web (RF-143 a RF-147), con el estado que vio el usuario. Si la
 * factura cambió mientras tanto (409), muestra el mensaje de la API; en cualquier caso recarga la vista
 * para mostrar el estado vigente (RF-218, AC-240).
 */
export async function changeInvoiceStatus(
  message: MessageInstance,
  invoice: { id: number; status: InvoiceStatus },
  to: 'pagada' | 'pendiente_de_pago',
  reload: () => Promise<void> | void,
): Promise<void> {
  try {
    await api.post(`/invoices/${invoice.id}/status`, { to, expectedStatus: invoice.status });
    message.success(SUCCESS[to]);
  } catch (e) {
    message.error(e instanceof ApiError && e.status === 409 ? e.message : errorMessage(e));
  }
  await reload();
}
