import { EditOutlined, PlusOutlined, StopOutlined, UndoOutlined } from '@ant-design/icons';
import type { ClientDto, ClientInput, ClientIvaCondition } from '@api-types';
import { App, Button, Input, Segmented, Space, Table, Tag, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import styled from 'styled-components';
import { api } from '../../api/client.ts';
import { TableAction } from '../../components/TableAction.tsx';
import { errorMessage } from '../../forms.ts';
import { formatCuit } from '../../format.ts';
import { useCanEdit } from '../../stores/session.ts';
import { ClientForm, ivaConditionLabel } from './ClientForm.tsx';

type StatusFilter = ClientDto['status'] | 'todos';

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'todos', label: 'Todos' },
  { value: 'activo', label: 'Activos' },
  { value: 'inactivo', label: 'Inactivos' },
];

const Toolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin-bottom: 16px;
`;

/** RF-169: busca por razón social (sin distinguir mayúsculas) o por los dígitos del CUIT. */
function matches(client: ClientDto, search: string): boolean {
  const text = search.trim().toLowerCase();
  if (!text) return true;
  const digits = text.replace(/\D/g, '');
  return client.businessName.toLowerCase().includes(text) || (digits !== '' && client.cuit.includes(digits));
}

/** Listado de clientes Activos e Inactivos con su alta, modificación, baja y reactivación (RF-34 a RF-37, RF-158). */
export function ClientsPage() {
  const canEdit = useCanEdit();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [clients, setClients] = useState<ClientDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<StatusFilter>('todos');
  const [search, setSearch] = useState('');
  // `undefined`: formulario cerrado; `null`: alta; un cliente: modificación.
  const [editing, setEditing] = useState<ClientDto | null | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setClients(await api.get<ClientDto[]>('/clients'));
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(input: ClientInput) {
    if (editing) await api.patch(`/clients/${editing.id}`, input);
    else await api.post('/clients', input);
    message.success(editing ? 'Cliente modificado.' : 'Cliente dado de alta.');
    setEditing(undefined);
    await load();
  }

  async function changeStatus(client: ClientDto) {
    const deactivate = client.status === 'activo';
    try {
      await api.post(`/clients/${client.id}/${deactivate ? 'deactivate' : 'reactivate'}`);
      message.success(deactivate ? 'Cliente dado de baja.' : 'Cliente reactivado.');
      await load();
    } catch (e) {
      message.error(errorMessage(e));
    }
  }

  const visible = clients.filter((c) => (status === 'todos' || c.status === status) && matches(c, search));
  const filtered = status !== 'todos' || search.trim() !== '';

  return (
    <>
      <Typography.Title level={3}>Clientes</Typography.Title>
      <Toolbar>
        <Input.Search
          placeholder="Buscar por razón social o CUIT"
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
            Nuevo cliente
          </Button>
        )}
      </Toolbar>
      <Table<ClientDto>
        rowKey="id"
        loading={loading}
        dataSource={visible}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        scroll={{ x: true }}
        locale={{ emptyText: filtered ? 'Ningún cliente coincide con el filtro.' : 'Todavía no hay clientes.' }}
        onRow={(client) => ({
          // Click o Enter en la fila abre el detalle del cliente (RF-214).
          onClick: () => navigate(`/clientes/${client.id}`),
          onKeyDown: (e) => {
            if (e.key === 'Enter' && e.target === e.currentTarget) navigate(`/clientes/${client.id}`);
          },
          tabIndex: 0,
          style: { cursor: 'pointer' },
        })}
        columns={[
          { title: 'Razón social', dataIndex: 'businessName' },
          { title: 'CUIT', dataIndex: 'cuit', render: (cuit: string) => formatCuit(cuit) },
          { title: 'Email de facturación', dataIndex: 'billingEmail' },
          {
            title: 'Condición frente al IVA',
            dataIndex: 'ivaCondition',
            render: (code: ClientIvaCondition | null) =>
              code === null ? <Typography.Text type="warning">Sin cargar</Typography.Text> : ivaConditionLabel(code),
          },
          {
            title: 'Estado',
            dataIndex: 'status',
            render: (value: ClientDto['status']) =>
              value === 'activo' ? <Tag color="green">Activo</Tag> : <Tag>Inactivo</Tag>,
          },
          ...(canEdit
            ? [
                {
                  title: 'Acciones',
                  key: 'acciones',
                  align: 'center' as const,
                  width: 110,
                  render: (_: unknown, client: ClientDto) => {
                    const active = client.status === 'activo';
                    return (
                      <Space size={4}>
                        <TableAction label="Modificar" icon={<EditOutlined />} onClick={() => setEditing(client)} />
                        <TableAction
                          label={active ? 'Dar de baja' : 'Reactivar'}
                          icon={active ? <StopOutlined /> : <UndoOutlined />}
                          danger={active}
                          confirm={active ? '¿Dar de baja este cliente?' : '¿Reactivar este cliente?'}
                          onClick={() => changeStatus(client)}
                        />
                      </Space>
                    );
                  },
                },
              ]
            : []),
        ]}
      />
      {editing !== undefined && <ClientForm client={editing} onSubmit={save} onClose={() => setEditing(undefined)} />}
    </>
  );
}
