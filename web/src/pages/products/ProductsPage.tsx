import { EditOutlined, PlusOutlined, StopOutlined, UndoOutlined } from '@ant-design/icons';
import type { Currency, ProductDto, ProductInput } from '@api-types';
import { App, Button, Input, Segmented, Space, Table, Tag, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { api } from '../../api/client.ts';
import { TableAction } from '../../components/TableAction.tsx';
import { errorMessage } from '../../forms.ts';
import { formatMoney } from '../../format.ts';
import { useCanEdit } from '../../stores/session.ts';
import { CURRENCY_LABELS, ProductForm } from './ProductForm.tsx';

type StatusFilter = ProductDto['status'] | 'todos';

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'todos', label: 'Todos' },
  { value: 'activo', label: 'Activos' },
  { value: 'inactivo', label: 'Inactivos' },
];

const DEACTIVATE_HINT =
  'Deja de estar disponible para nuevas asignaciones y no se incluye en las próximas facturas (AC-47).';

const Toolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin-bottom: 16px;
`;

/** Listado de productos Activos e Inactivos con su alta, modificación y desactivación (RF-42 a RF-48, RF-159). */
export function ProductsPage() {
  const canEdit = useCanEdit();
  const { message } = App.useApp();
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<StatusFilter>('todos');
  const [search, setSearch] = useState('');
  // `undefined`: formulario cerrado; `null`: alta; un producto: modificación.
  const [editing, setEditing] = useState<ProductDto | null | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setProducts(await api.get<ProductDto[]>('/products'));
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(input: ProductInput) {
    if (editing) await api.patch(`/products/${editing.id}`, input);
    else await api.post('/products', input);
    message.success(editing ? 'Producto modificado.' : 'Producto dado de alta.');
    setEditing(undefined);
    await load();
  }

  async function changeStatus(product: ProductDto) {
    const deactivate = product.status === 'activo';
    try {
      await api.post(`/products/${product.id}/${deactivate ? 'deactivate' : 'reactivate'}`);
      message.success(deactivate ? 'Producto desactivado.' : 'Producto reactivado.');
      await load();
    } catch (e) {
      message.error(errorMessage(e));
    }
  }

  const text = search.trim().toLowerCase();
  const visible = products.filter(
    (p) => (status === 'todos' || p.status === status) && p.name.toLowerCase().includes(text),
  );
  const filtered = status !== 'todos' || text !== '';

  return (
    <>
      <Typography.Title level={3}>Productos</Typography.Title>
      <Toolbar>
        <Input.Search
          placeholder="Buscar por nombre"
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 320 }}
        />
        <Segmented<StatusFilter> options={STATUS_OPTIONS} value={status} onChange={setStatus} />
        {canEdit && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setEditing(null)}
            style={{ marginInlineStart: 'auto' }}
          >
            Nuevo producto
          </Button>
        )}
      </Toolbar>
      <Table<ProductDto>
        rowKey="id"
        loading={loading}
        dataSource={visible}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        scroll={{ x: true }}
        locale={{ emptyText: filtered ? 'Ningún producto coincide con el filtro.' : 'Todavía no hay productos.' }}
        columns={[
          { title: 'Nombre', dataIndex: 'name' },
          {
            title: 'Cuota mensual',
            key: 'precio',
            align: 'right',
            render: (_, p) => <span style={{ whiteSpace: 'nowrap' }}>{formatMoney(p.priceCents, p.currency)}</span>,
          },
          { title: 'Moneda', dataIndex: 'currency', render: (currency: Currency) => CURRENCY_LABELS[currency] },
          {
            title: 'Estado',
            dataIndex: 'status',
            render: (value: ProductDto['status']) =>
              value === 'activo' ? <Tag color="green">Activo</Tag> : <Tag>Inactivo</Tag>,
          },
          ...(canEdit
            ? [
                {
                  title: 'Acciones',
                  key: 'acciones',
                  align: 'center' as const,
                  width: 110,
                  render: (_: unknown, product: ProductDto) => {
                    const active = product.status === 'activo';
                    return (
                      <Space size={4}>
                        <TableAction label="Modificar" icon={<EditOutlined />} onClick={() => setEditing(product)} />
                        <TableAction
                          label={active ? 'Desactivar' : 'Reactivar'}
                          icon={active ? <StopOutlined /> : <UndoOutlined />}
                          danger={active}
                          confirm={active ? '¿Desactivar este producto?' : '¿Reactivar este producto?'}
                          confirmDescription={active ? DEACTIVATE_HINT : undefined}
                          onClick={() => changeStatus(product)}
                        />
                      </Space>
                    );
                  },
                },
              ]
            : []),
        ]}
      />
      {editing !== undefined && (
        <ProductForm product={editing} onSubmit={save} onClose={() => setEditing(undefined)} />
      )}
    </>
  );
}
