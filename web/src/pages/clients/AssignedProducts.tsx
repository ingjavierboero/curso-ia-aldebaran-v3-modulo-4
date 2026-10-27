import { DisconnectOutlined, PlusOutlined } from '@ant-design/icons';
import type { ProductDto } from '@api-types';
import { Alert, App, Button, Card, Modal, Select, Table, Tag, Tooltip } from 'antd';
import { useState } from 'react';
import { api } from '../../api/client.ts';
import { TableAction } from '../../components/TableAction.tsx';
import { errorMessage } from '../../forms.ts';
import { formatMoney } from '../../format.ts';

/**
 * Productos asignados a un cliente, con la asignación de productos Activos y la desasignación
 * (RF-49, RF-50). Cada cambio envía la lista completa de productos que tienen que quedar asignados.
 */
export function AssignedProducts({
  clientId,
  assigned,
  catalog,
  canEdit,
  onChange,
}: {
  clientId: number;
  assigned: ProductDto[];
  /** Todos los productos, para ofrecer los Activos que todavía no están asignados. */
  catalog: ProductDto[];
  canEdit: boolean;
  onChange: (assigned: ProductDto[]) => void;
}) {
  const { message } = App.useApp();
  const [picking, setPicking] = useState(false);

  async function save(productIds: number[], success: string) {
    const updated = await api.put<ProductDto[]>(`/clients/${clientId}/products`, { productIds });
    onChange(updated);
    message.success(success);
  }

  async function unassign(product: ProductDto) {
    try {
      const ids = assigned.filter((p) => p.id !== product.id).map((p) => p.id);
      await save(ids, 'Producto desasignado.');
    } catch (e) {
      message.error(errorMessage(e));
    }
  }

  const available = catalog.filter((p) => p.status === 'activo' && !assigned.some((a) => a.id === p.id));

  return (
    <Card
      title="Productos asignados"
      extra={
        canEdit && (
          <Button icon={<PlusOutlined />} onClick={() => setPicking(true)} disabled={available.length === 0}>
            Asignar productos
          </Button>
        )
      }
    >
      <Table<ProductDto>
        rowKey="id"
        dataSource={assigned}
        pagination={false}
        scroll={{ x: true }}
        locale={{ emptyText: 'El cliente no tiene productos asignados.' }}
        columns={[
          { title: 'Producto', dataIndex: 'name' },
          {
            title: 'Cuota mensual',
            key: 'precio',
            align: 'right',
            render: (_, p) => <span style={{ whiteSpace: 'nowrap' }}>{formatMoney(p.priceCents, p.currency)}</span>,
          },
          {
            title: 'Estado',
            dataIndex: 'status',
            render: (status: ProductDto['status']) =>
              status === 'activo' ? (
                <Tag color="green">Activo</Tag>
              ) : (
                <Tooltip title="Los productos Inactivos no se facturan.">
                  <Tag>Inactivo</Tag>
                </Tooltip>
              ),
          },
          ...(canEdit
            ? [
                {
                  title: 'Acciones',
                  key: 'acciones',
                  align: 'center' as const,
                  width: 100,
                  render: (_: unknown, product: ProductDto) => (
                    <TableAction
                      label="Desasignar"
                      icon={<DisconnectOutlined />}
                      danger
                      confirm={`¿Desasignar ${product.name}?`}
                      confirmDescription="Deja de incluirse en las próximas facturas del cliente."
                      onClick={() => unassign(product)}
                    />
                  ),
                },
              ]
            : []),
        ]}
      />
      {picking && (
        <AssignModal
          available={available}
          onAssign={(ids) => save([...assigned.map((p) => p.id), ...ids], 'Productos asignados.')}
          onClose={() => setPicking(false)}
        />
      )}
    </Card>
  );
}

/** Selector de los productos Activos que todavía no están asignados al cliente. */
function AssignModal({
  available,
  onAssign,
  onClose,
}: {
  available: ProductDto[];
  onAssign: (productIds: number[]) => Promise<void>;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function assign() {
    setSaving(true);
    setError(null);
    try {
      await onAssign(selected);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title="Asignar productos"
      okText="Asignar"
      cancelText="Cancelar"
      okButtonProps={{ disabled: selected.length === 0 }}
      confirmLoading={saving}
      onOk={assign}
      onCancel={onClose}
      destroyOnHidden
    >
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
      <Select<number[]>
        mode="multiple"
        style={{ width: '100%' }}
        placeholder="Elegí uno o más productos Activos"
        value={selected}
        onChange={setSelected}
        showSearch={{ optionFilterProp: 'label' }}
        options={available.map((p) => ({ value: p.id, label: p.name }))}
      />
    </Modal>
  );
}
