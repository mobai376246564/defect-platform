import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Modal,
  Popconfirm,
  Result,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { api } from '../api/client';
import { qk } from '../api/hooks';
import type { AdminUser } from '../api/types';
import { useAuth } from '../auth/AuthContext';

const passwordRules = [
  { required: true, message: '请输入密码' },
  { min: 8, message: '密码至少 8 位' },
  { max: 72, message: '密码最多 72 位' },
];

interface CreateValues {
  email: string;
  name: string;
  password: string;
  isSystemAdmin?: boolean;
}

interface EditValues {
  name: string;
  isSystemAdmin?: boolean;
}

/** 系统用户管理：仅系统管理员可见。邮箱只作登录名，不发验证邮件。 */
export function UsersPage() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const users = useQuery({
    queryKey: qk.adminUsers,
    queryFn: () => api<AdminUser[]>('/admin/users'),
    enabled: !!user?.isSystemAdmin,
  });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: qk.adminUsers });
  const onError = (e: Error) => message.error(e.message);

  const create = useMutation({
    mutationFn: (v: CreateValues) =>
      api('/admin/users', { method: 'POST', body: { ...v, isSystemAdmin: !!v.isSystemAdmin } }),
    onSuccess: () => {
      setCreating(false);
      message.success('用户已创建');
      refresh();
    },
    onError,
  });
  const update = useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      name?: string;
      isSystemAdmin?: boolean;
      disabled?: boolean;
    }) => api(`/admin/users/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
    onError,
  });
  const resetPassword = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      api(`/admin/users/${id}/password`, { method: 'POST', body: { password } }),
    onSuccess: () => {
      setResetting(null);
      message.success('密码已重置，请把新密码告知对方');
    },
    onError,
  });

  if (!user?.isSystemAdmin) {
    return <Result status="403" title="无权限" subTitle="只有系统管理员可以管理用户" />;
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0, flex: 1 }}>
          用户管理
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
          新建用户
        </Button>
      </div>
      <Card>
        <Table<AdminUser>
          rowKey="id"
          size="small"
          loading={users.isLoading}
          dataSource={users.data ?? []}
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          columns={[
            {
              title: '姓名',
              dataIndex: 'name',
              render: (v: string, u) => (
                <Space>
                  {v}
                  {u.id === user.id && <Tag>我</Tag>}
                </Space>
              ),
            },
            { title: '邮箱（登录名）', dataIndex: 'email' },
            {
              title: '角色',
              dataIndex: 'isSystemAdmin',
              render: (v: boolean) => (v ? <Tag color="gold">系统管理员</Tag> : '普通用户'),
            },
            {
              title: '状态',
              dataIndex: 'disabledAt',
              render: (v: string | null) =>
                v ? <Tag color="red">已禁用</Tag> : <Tag color="green">正常</Tag>,
            },
            {
              title: '创建时间',
              dataIndex: 'createdAt',
              render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
            },
            {
              title: '操作',
              width: 220,
              render: (_, u) => {
                const self = u.id === user.id;
                return (
                  <Space size={0}>
                    <Button type="link" size="small" onClick={() => setEditing(u)}>
                      编辑
                    </Button>
                    <Button type="link" size="small" onClick={() => setResetting(u)}>
                      重置密码
                    </Button>
                    {u.disabledAt ? (
                      <Button
                        type="link"
                        size="small"
                        onClick={() => update.mutate({ id: u.id, disabled: false })}
                      >
                        启用
                      </Button>
                    ) : (
                      <Popconfirm
                        title={`禁用 ${u.name}？`}
                        description="禁用后无法登录，个人 API Token 也会失效；可随时重新启用"
                        disabled={self}
                        onConfirm={() => update.mutate({ id: u.id, disabled: true })}
                      >
                        <Button type="link" size="small" danger disabled={self}>
                          禁用
                        </Button>
                      </Popconfirm>
                    )}
                  </Space>
                );
              },
            },
          ]}
        />
      </Card>

      <Modal
        title="新建用户"
        open={creating}
        onCancel={() => setCreating(false)}
        footer={null}
        destroyOnHidden
      >
        <Form<CreateValues> layout="vertical" onFinish={(v) => create.mutate(v)}>
          <Form.Item
            name="email"
            label="邮箱（登录名）"
            rules={[{ required: true, type: 'email', message: '请输入有效邮箱' }]}
          >
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item name="name" label="姓名" rules={[{ required: true, max: 50 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="初始密码" rules={passwordRules}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="isSystemAdmin" valuePropName="checked">
            <Checkbox>系统管理员（可新建项目、管理用户）</Checkbox>
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={create.isPending}>
            创建
          </Button>
        </Form>
      </Modal>

      <Modal
        title="编辑用户"
        open={!!editing}
        onCancel={() => setEditing(null)}
        footer={null}
        destroyOnHidden
      >
        {editing && (
          <Form<EditValues>
            layout="vertical"
            initialValues={{ name: editing.name, isSystemAdmin: editing.isSystemAdmin }}
            onFinish={(v) =>
              update.mutate({ id: editing.id, name: v.name, isSystemAdmin: !!v.isSystemAdmin })
            }
          >
            <Form.Item label="邮箱（登录名）">
              <Input value={editing.email} disabled />
            </Form.Item>
            <Form.Item name="name" label="姓名" rules={[{ required: true, max: 50 }]}>
              <Input />
            </Form.Item>
            <Form.Item
              name="isSystemAdmin"
              valuePropName="checked"
              extra={editing.id === user.id ? '不能取消自己的系统管理员' : undefined}
            >
              <Checkbox disabled={editing.id === user.id}>系统管理员</Checkbox>
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={update.isPending}>
              保存
            </Button>
          </Form>
        )}
      </Modal>

      <Modal
        title={`重置密码：${resetting?.name ?? ''}`}
        open={!!resetting}
        onCancel={() => setResetting(null)}
        footer={null}
        destroyOnHidden
      >
        {resetting && (
          <Form<{ password: string }>
            layout="vertical"
            onFinish={(v) => resetPassword.mutate({ id: resetting.id, password: v.password })}
          >
            <Form.Item name="password" label="新密码" rules={passwordRules}>
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={resetPassword.isPending}>
              重置
            </Button>
          </Form>
        )}
      </Modal>
    </div>
  );
}
