import type { Role, UserDto } from '@api-types';
import { Alert, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import { emailRules, errorMessage, newPasswordRules } from '../forms.ts';
import { ROLE_LABELS } from '../stores/session.ts';

interface UserForm {
  name: string;
  email: string;
  role: Role;
  password?: string;
}

const ROLE_OPTIONS = (Object.keys(ROLE_LABELS) as Role[]).map((value) => ({ value, label: ROLE_LABELS[value] }));

/** Alta, modificación, baja y reactivación de usuarios; solo para Admin (RF-14 a RF-20, RF-161). */
export function UsersPage() {
  const [users, setUsers] = useState<UserDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // `undefined`: modal cerrado; `null`: alta; un usuario: modificación.
  const [editing, setEditing] = useState<UserDto | null | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await api.get<UserDto[]>('/users'));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeStatus(user: UserDto) {
    try {
      await api.post(`/users/${user.id}/${user.status === 'activo' ? 'deactivate' : 'reactivate'}`);
      await load();
    } catch (e) {
      setError(errorMessage(e)); // por ejemplo, la baja del único Admin Activo (RF-20)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Space style={{ justifyContent: 'space-between' }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Usuarios
        </Typography.Title>
        <Button type="primary" onClick={() => setEditing(null)}>
          Nuevo usuario
        </Button>
      </Space>
      {error && <Alert type="error" title={error} closable onClose={() => setError(null)} />}
      <Table<UserDto>
        rowKey="id"
        loading={loading}
        dataSource={users}
        pagination={false}
        columns={[
          { title: 'Nombre', dataIndex: 'name' },
          { title: 'Email', dataIndex: 'email' },
          { title: 'Perfil', dataIndex: 'role', render: (role: Role) => ROLE_LABELS[role] },
          {
            title: 'Estado',
            dataIndex: 'status',
            render: (status: UserDto['status']) =>
              status === 'activo' ? <Tag color="success">Activo</Tag> : <Tag>Inactivo</Tag>,
          },
          {
            title: 'Acciones',
            key: 'acciones',
            render: (_, user) => (
              <Space>
                <Button size="small" onClick={() => setEditing(user)}>
                  Modificar
                </Button>
                <Popconfirm
                  title={user.status === 'activo' ? '¿Dar de baja al usuario?' : '¿Reactivar al usuario?'}
                  description={user.status === 'activo' ? 'Se cierran todas sus sesiones abiertas.' : undefined}
                  okText="Sí"
                  cancelText="No"
                  onConfirm={() => changeStatus(user)}
                >
                  <Button size="small" danger={user.status === 'activo'}>
                    {user.status === 'activo' ? 'Dar de baja' : 'Reactivar'}
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      {editing !== undefined && (
        <UserModal
          user={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void load();
          }}
        />
      )}
    </div>
  );
}

/** Formulario de alta (con contraseña inicial) o de modificación de nombre, email y perfil. */
function UserModal({ user, onClose, onSaved }: { user: UserDto | null; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm<UserForm>();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(values: UserForm) {
    setSaving(true);
    setError(null);
    try {
      if (user) await api.patch(`/users/${user.id}`, { name: values.name, email: values.email, role: values.role });
      else await api.post('/users', values);
      onSaved();
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
      {error && <Alert type="error" title={error} style={{ marginBottom: 16 }} />}
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
