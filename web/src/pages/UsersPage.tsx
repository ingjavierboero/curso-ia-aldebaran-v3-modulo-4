import { CheckCircleOutlined, EditOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons';
import type { Role, UserDto } from '@api-types';
import { Alert, App, Button, Form, Input, Modal, Segmented, Select, Space, Table, Tag, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { api } from '../api/client.ts';
import { TableAction } from '../components/TableAction.tsx';
import { emailRules, errorMessage, newPasswordRules } from '../forms.ts';
import { ROLE_LABELS } from '../stores/session.ts';

interface UserForm {
  name: string;
  email: string;
  role: Role;
  password?: string;
}

const ROLE_OPTIONS = (Object.keys(ROLE_LABELS) as Role[]).map((value) => ({ value, label: ROLE_LABELS[value] }));

type StatusFilter = UserDto['status'] | 'todos';

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

/** Alta, modificación, baja y reactivación de usuarios; solo para Admin (RF-14 a RF-20, RF-161). */
export function UsersPage() {
  const { message } = App.useApp();
  const [users, setUsers] = useState<UserDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<StatusFilter>('todos');
  // `undefined`: modal cerrado; `null`: alta; un usuario: modificación.
  const [editing, setEditing] = useState<UserDto | null | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await api.get<UserDto[]>('/users'));
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeStatus(user: UserDto) {
    const deactivate = user.status === 'activo';
    try {
      await api.post(`/users/${user.id}/${deactivate ? 'deactivate' : 'reactivate'}`);
      message.success(deactivate ? 'Usuario dado de baja.' : 'Usuario reactivado.');
      await load();
    } catch (e) {
      message.error(errorMessage(e)); // por ejemplo, la baja del único Admin Activo (RF-20)
    }
  }

  const visible = status === 'todos' ? users : users.filter((user) => user.status === status);

  return (
    <>
      <Typography.Title level={3}>Usuarios</Typography.Title>
      <Toolbar>
        <Segmented<StatusFilter> options={STATUS_OPTIONS} value={status} onChange={setStatus} />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setEditing(null)}
          style={{ marginInlineStart: 'auto' }}
        >
          Nuevo usuario
        </Button>
      </Toolbar>
      <Table<UserDto>
        rowKey="id"
        loading={loading}
        dataSource={visible}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        scroll={{ x: true }}
        locale={{
          emptyText: status === 'todos' ? 'Todavía no hay usuarios.' : 'Ningún usuario coincide con el filtro.',
        }}
        columns={[
          { title: 'Nombre', dataIndex: 'name' },
          { title: 'Email', dataIndex: 'email' },
          { title: 'Perfil', dataIndex: 'role', render: (role: Role) => ROLE_LABELS[role] },
          {
            title: 'Estado',
            dataIndex: 'status',
            render: (status: UserDto['status']) =>
              status === 'activo' ? <Tag color="green">Activo</Tag> : <Tag>Inactivo</Tag>,
          },
          {
            title: 'Acciones',
            key: 'acciones',
            align: 'center',
            width: 110,
            render: (_, user) => (
              <Space size={4}>
                <TableAction label="Modificar" icon={<EditOutlined />} onClick={() => setEditing(user)} />
                {user.status === 'activo' ? (
                  <TableAction
                    label="Dar de baja"
                    icon={<StopOutlined />}
                    danger
                    confirm="¿Dar de baja al usuario?"
                    confirmDescription="Se cierran todas sus sesiones abiertas."
                    onClick={() => changeStatus(user)}
                  />
                ) : (
                  <TableAction
                    label="Reactivar"
                    icon={<CheckCircleOutlined />}
                    confirm="¿Reactivar al usuario?"
                    onClick={() => changeStatus(user)}
                  />
                )}
              </Space>
            ),
          },
        ]}
      />
      {editing !== undefined && (
        <UserModal
          user={editing}
          onClose={() => setEditing(undefined)}
          onSaved={(created) => {
            message.success(created ? 'Usuario dado de alta.' : 'Usuario modificado.');
            setEditing(undefined);
            void load();
          }}
        />
      )}
    </>
  );
}

/** Formulario de alta (con contraseña inicial) o de modificación de nombre, email y perfil. */
function UserModal({
  user,
  onClose,
  onSaved,
}: {
  user: UserDto | null;
  onClose: () => void;
  onSaved: (created: boolean) => void;
}) {
  const [form] = Form.useForm<UserForm>();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(values: UserForm) {
    setSaving(true);
    setError(null);
    try {
      if (user) await api.patch(`/users/${user.id}`, { name: values.name, email: values.email, role: values.role });
      else await api.post('/users', values);
      onSaved(!user);
    } catch (e) {
      setError(errorMessage(e)); // email repetido (RF-15) o último Admin (RF-20)
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={user ? 'Modificar usuario' : 'Nuevo usuario'}
      okText="Guardar"
      cancelText="Cancelar"
      confirmLoading={saving}
      onOk={() => form.submit()}
      onCancel={onClose}
      destroyOnHidden
    >
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
      <Form<UserForm>
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={user ?? { role: 'consulta' }}
        onFinish={submit}
      >
        <Form.Item
          label="Nombre"
          name="name"
          rules={[{ required: true, whitespace: true, message: 'El nombre es obligatorio.' }]}
        >
          <Input />
        </Form.Item>
        <Form.Item label="Email" name="email" rules={emailRules}>
          <Input type="email" />
        </Form.Item>
        <Form.Item label="Perfil" name="role" rules={[{ required: true, message: 'El perfil es obligatorio.' }]}>
          <Select options={ROLE_OPTIONS} />
        </Form.Item>
        {!user && (
          <Form.Item label="Contraseña inicial" name="password" rules={newPasswordRules}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}
