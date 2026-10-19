import { PlusOutlined } from '@ant-design/icons';
import { POSITION, POSITIONS, USER_STATUS, USERNAME_PATTERN, type Position } from '@defect/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Modal,
  Popconfirm,
  Result,
  Segmented,
  Select,
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

const positionOptions = POSITIONS.map((p) => ({ value: p, label: POSITION[p] }));

interface CreateValues {
  username: string;
  email?: string;
  name: string;
  position: Position;
  password: string;
  isSystemAdmin?: boolean;
}

interface EditValues {
  name: string;
  position: Position;
  isSystemAdmin?: boolean;
}

/** 待审核注册数（导航角标）。挂在 adminUsers 下，用户列表刷新时一并失效。 */
export function usePendingUserCount(enabled: boolean) {
  return useQuery({
    queryKey: [...qk.adminUsers, 'pending-count'],
    queryFn: () => api<{ count: number }>('/admin/users/pending-count'),
    enabled,
    refetchInterval: 60_000,
  });
}

function StatusTag({ u }: { u: AdminUser }) {
  if (u.status === 'pending') return <Tag color="orange">{USER_STATUS.pending}</Tag>;
  if (u.status === 'rejected') return <Tag>{USER_STATUS.rejected}</Tag>;
  if (u.disabledAt) return <Tag color="red">已禁用</Tag>;
  return <Tag color="green">{USER_STATUS.active}</Tag>;
}

/** 系统用户管理：仅系统管理员可见。审核自助注册的账号，或直接建号。 */
export function UsersPage() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const users = useQuery({
    queryKey: qk.adminUsers,
    queryFn: () => api<AdminUser[]>('/admin/users'),
    enabled: !!user?.isSystemAdmin,
  });
  const [filter, setFilter] = useState<'all' | 'pending'>('all');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [approving, setApproving] = useState<AdminUser | null>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: qk.adminUsers });
  const onError = (e: Error) => message.error(e.message);

  const create = useMutation({
    mutationFn: (v: CreateValues) =>
      api('/admin/users', {
        method: 'POST',
        body: { ...v, email: v.email?.trim() || undefined, isSystemAdmin: !!v.isSystemAdmin },
      }),
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
      position?: Position;
      isSystemAdmin?: boolean;
      disabled?: boolean;
    }) => api(`/admin/users/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
    onError,
  });
  const approve = useMutation({
    mutationFn: ({ id, isSystemAdmin }: { id: string; isSystemAdmin: boolean }) =>
      api(`/admin/users/${id}/approve`, { method: 'POST', body: { isSystemAdmin } }),
    onSuccess: () => {
      setApproving(null);
      message.success('已通过审核，对方现在可以登录');
      refresh();
    },
    onError,
  });
  const reject = useMutation({
    mutationFn: (id: string) => api(`/admin/users/${id}/reject`, { method: 'POST' }),
    onSuccess: () => {
      message.success('已拒绝');
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

  const all = users.data ?? [];
  const pending = all.filter((u) => u.status === 'pending');
  const rows = filter === 'pending' ? pending : all;

  const actions = (u: AdminUser) => {
    const self = u.id === user.id;
    if (u.status === 'pending') {
      return (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => setApproving(u)}>
            通过
          </Button>
          <Popconfirm
            title={`拒绝 ${u.username} 的注册？`}
            description="拒绝后该账号无法登录，之后仍可重新通过"
            onConfirm={() => reject.mutate(u.id)}
          >
            <Button type="link" size="small" danger>
              拒绝
            </Button>
          </Popconfirm>
        </Space>
      );
    }
    if (u.status === 'rejected') {
      return (
        <Button type="link" size="small" onClick={() => setApproving(u)}>
          重新通过
        </Button>
      );
    }
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
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0, flex: 1 }}>
          用户管理
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
          新建用户
        </Button>
      </div>
      {pending.length > 0 && filter === 'all' && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`有 ${pending.length} 个注册待审核`}
          action={
            <Button size="small" onClick={() => setFilter('pending')}>
              去审核
            </Button>
          }
        />
      )}
      <Card>
        <Segmented
          style={{ marginBottom: 12 }}
          value={filter}
          onChange={(v) => setFilter(v as 'all' | 'pending')}
          options={[
            { value: 'all', label: `全部（${all.length}）` },
            { value: 'pending', label: `待审核（${pending.length}）` },
          ]}
        />
        <Table<AdminUser>
          rowKey="id"
          size="small"
          loading={users.isLoading}
          dataSource={rows}
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          scroll={{ x: 'max-content' }}
          columns={[
            {
              title: '账号',
              dataIndex: 'username',
              render: (v: string, u) => (
                <Space>
                  {v}
                  {u.id === user.id && <Tag>我</Tag>}
                </Space>
              ),
            },
            { title: '姓名', dataIndex: 'name' },
            {
              title: '职位',
              dataIndex: 'position',
              render: (v: Position) => POSITION[v] ?? v,
            },
            { title: '邮箱', dataIndex: 'email', render: (v: string | null) => v ?? '—' },
            {
              title: '角色',
              dataIndex: 'isSystemAdmin',
              render: (v: boolean) => (v ? <Tag color="gold">系统管理员</Tag> : '普通用户'),
            },
            { title: '状态', key: 'status', render: (_, u) => <StatusTag u={u} /> },
            {
              title: '注册 / 创建时间',
              dataIndex: 'createdAt',
              render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
            },
            { title: '操作', key: 'actions', render: (_, u) => actions(u) },
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
        <Form<CreateValues>
          layout="vertical"
          initialValues={{ position: 'other' }}
          onFinish={(v) => create.mutate(v)}
        >
          <Form.Item
            name="username"
            label="账号"
            extra="3–32 位字母、数字、下划线、点或横线"
            rules={[
              { required: true, message: '请输入账号' },
              { pattern: USERNAME_PATTERN, message: '账号格式不正确' },
            ]}
          >
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item name="name" label="姓名" rules={[{ required: true, max: 50 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="position" label="职位" rules={[{ required: true }]}>
            <Select options={positionOptions} />
          </Form.Item>
          <Form.Item
            name="email"
            label="邮箱（选填，也可用于登录）"
            rules={[{ type: 'email', message: '请输入有效邮箱' }]}
          >
            <Input autoComplete="off" />
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
            initialValues={{
              name: editing.name,
              position: editing.position,
              isSystemAdmin: editing.isSystemAdmin,
            }}
            onFinish={(v) =>
              update.mutate({
                id: editing.id,
                name: v.name,
                position: v.position,
                isSystemAdmin: !!v.isSystemAdmin,
              })
            }
          >
            <Form.Item label="账号">
              <Input value={editing.username} disabled />
            </Form.Item>
            <Form.Item name="name" label="姓名" rules={[{ required: true, max: 50 }]}>
              <Input />
            </Form.Item>
            <Form.Item name="position" label="职位" rules={[{ required: true }]}>
              <Select options={positionOptions} />
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
        title={`通过注册：${approving?.username ?? ''}`}
        open={!!approving}
        onCancel={() => setApproving(null)}
        footer={null}
        destroyOnHidden
      >
        {approving && (
          <Form<{ isSystemAdmin?: boolean }>
            layout="vertical"
            onFinish={(v) => approve.mutate({ id: approving.id, isSystemAdmin: !!v.isSystemAdmin })}
          >
            <Typography.Paragraph>
              {approving.name}，职位：{POSITION[approving.position] ?? approving.position}
              。通过后即可登录，再由项目管理员把 TA 加入项目。
            </Typography.Paragraph>
            <Form.Item name="isSystemAdmin" valuePropName="checked">
              <Checkbox>同时设为系统管理员</Checkbox>
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={approve.isPending}>
              通过
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
