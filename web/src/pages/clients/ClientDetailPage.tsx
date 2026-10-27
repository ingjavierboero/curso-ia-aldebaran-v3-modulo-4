import { ArrowLeftOutlined, EditOutlined, StopOutlined, UndoOutlined } from '@ant-design/icons';
import type { ClientDto, ClientInput, ProductDto } from '@api-types';
import { App, Button, Card, Descriptions, Popconfirm, Result, Space, Spin, Tag, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import styled from 'styled-components';
import { ApiError, api } from '../../api/client.ts';
import { errorMessage } from '../../forms.ts';
import { formatCuit, formatDate } from '../../format.ts';
import { useCanEdit } from '../../stores/session.ts';
import { AssignedProducts } from './AssignedProducts.tsx';
import { ClientForm, ivaConditionLabel } from './ClientForm.tsx';

const Header = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin-bottom: 16px;

  h3 {
    margin: 0;
  }
`;

const Sections = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

/** Detalle de un cliente con sus datos y sus productos asignados (RF-214, RF-49, RF-50). */
export function ClientDetailPage() {
  const { id } = useParams();
  const canEdit = useCanEdit();
  const { message } = App.useApp();
  const [client, setClient] = useState<ClientDto | null>(null);
  const [assigned, setAssigned] = useState<ProductDto[]>([]);
  const [catalog, setCatalog] = useState<ProductDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [loaded, products] = await Promise.all([
        api.get<ClientDto>(`/clients/${id}`),
        api.get<ProductDto[]>(`/clients/${id}/products`),
      ]);
      setClient(loaded);
      setAssigned(products);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? 'El cliente no existe.' : errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // El catálogo solo hace falta para asignar productos.
  useEffect(() => {
    if (!canEdit) return;
    api
      .get<ProductDto[]>('/products')
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, [canEdit]);

  async function save(input: ClientInput) {
    setClient(await api.patch<ClientDto>(`/clients/${id}`, input));
    setEditing(false);
    message.success('Cliente modificado.');
  }

  async function changeStatus() {
    if (!client) return;
    const deactivate = client.status === 'activo';
    try {
      setClient(await api.post<ClientDto>(`/clients/${client.id}/${deactivate ? 'deactivate' : 'reactivate'}`));
      message.success(deactivate ? 'Cliente dado de baja.' : 'Cliente reactivado.');
    } catch (e) {
      message.error(errorMessage(e));
    }
  }

  if (error) {
    return (
      <Result
        status="404"
        title={error}
        extra={
          <Link to="/clientes">
            <Button>Volver a clientes</Button>
          </Link>
        }
      />
    );
  }
  if (!client) return <Spin style={{ display: 'block', margin: '48px auto' }} />;

  const active = client.status === 'activo';

  return (
    <>
      <Header>
        <Link to="/clientes" aria-label="Volver a clientes">
          <Button type="text" icon={<ArrowLeftOutlined />} />
        </Link>
        <Typography.Title level={3}>{client.businessName}</Typography.Title>
        {active ? <Tag color="green">Activo</Tag> : <Tag>Inactivo</Tag>}
        {canEdit && (
          <Space style={{ marginInlineStart: 'auto' }}>
            <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
              Modificar
            </Button>
            <Popconfirm
              title={active ? '¿Dar de baja este cliente?' : '¿Reactivar este cliente?'}
              okText="Sí"
              cancelText="No"
              onConfirm={changeStatus}
            >
              <Button danger={active} icon={active ? <StopOutlined /> : <UndoOutlined />}>
                {active ? 'Dar de baja' : 'Reactivar'}
              </Button>
            </Popconfirm>
          </Space>
        )}
      </Header>
      <Sections>
        <Card title="Datos del cliente">
          <Descriptions column={{ xs: 1, md: 2 }}>
            <Descriptions.Item label="Razón social">{client.businessName}</Descriptions.Item>
            <Descriptions.Item label="CUIT">{formatCuit(client.cuit)}</Descriptions.Item>
            <Descriptions.Item label="Domicilio">{client.address}</Descriptions.Item>
            <Descriptions.Item label="Email de facturación">{client.billingEmail}</Descriptions.Item>
            <Descriptions.Item label="Condición frente al IVA">
              {client.ivaCondition === null ? (
                <Typography.Text type="warning">Sin cargar</Typography.Text>
              ) : (
                ivaConditionLabel(client.ivaCondition)
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Fecha de alta">{formatDate(client.createdAt)}</Descriptions.Item>
          </Descriptions>
        </Card>
        <AssignedProducts
          clientId={client.id}
          assigned={assigned}
          catalog={catalog}
          canEdit={canEdit}
          onChange={setAssigned}
        />
      </Sections>
      {editing && <ClientForm client={client} onSubmit={save} onClose={() => setEditing(false)} />}
    </>
  );
}
