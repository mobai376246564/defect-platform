import { CopyOutlined, PlusOutlined } from '@ant-design/icons';
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
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { api } from '../api/client';
import { qk } from '../api/hooks';
import type { ApiTokenItem } from '../api/types';
import { useAuth } from '../auth/AuthContext';

interface PasswordValues {
  oldPassword: string;
  newPassword: string;
  confirm: string;
}

const mcpUrl = () => `${window.location.origin}/api/v1/mcp`;

export function MePage() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const tokens = useQuery({
    queryKey: qk.tokens,
    queryFn: () => api<ApiTokenItem[]>('/auth/tokens'),
  });
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [pwdForm] = Form.useForm<PasswordValues>();

  const create = useMutation({
    mutationFn: (v: { name: string; readOnly?: boolean }) =>
      api<{ token: string }>('/auth/tokens', {
        method: 'POST',
        body: { name: v.name, readOnly: !!v.readOnly },
      }),
    onSuccess: (res) => {
      setCreating(false);
      setNewToken(res.token);
      void qc.invalidateQueries({ queryKey: qk.tokens });
    },
    onError: (e: Error) => message.error(e.message),
  });
  const changePassword = useMutation({
    mutationFn: (v: PasswordValues) =>
      api('/auth/password', {
        method: 'POST',
        body: { oldPassword: v.oldPassword, newPassword: v.newPassword },
      }),
    onSuccess: () => {
      pwdForm.resetFields();
      message.success('密码已修改，下次登录请使用新密码');
    },
    onError: (e: Error) => message.error(e.message),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/auth/tokens/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.tokens }),
  });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success('已复制');
    } catch {
      message.info('请手动复制');
    }
  };
  const addCmd = (token: string) =>
    `claude mcp add --transport http defects ${mcpUrl()} --header "Authorization: Bearer ${token}"`;

  return (
    <div>
      <Typography.Title level={4}>个人设置</Typography.Title>
      <div className="card-grid">
        <Card className="span-2">
          <Typography.Text>
            {user?.name}（账号 {user?.username}
            {user?.email ? `，${user.email}` : ''}）
            {user?.isSystemAdmin && <Tag color="gold">系统管理员</Tag>}
          </Typography.Text>
        </Card>

        <Card title="修改密码" style={{ marginBottom: 16 }}>
          <Form<PasswordValues>
            form={pwdForm}
            layout="vertical"
            style={{ maxWidth: 360 }}
            onFinish={(v) => changePassword.mutate(v)}
          >
            <Form.Item
              name="oldPassword"
              label="当前密码"
              rules={[{ required: true, message: '请输入当前密码' }]}
            >
              <Input.Password autoComplete="current-password" />
            </Form.Item>
            <Form.Item
              name="newPassword"
              label="新密码"
              rules={[
                { required: true, message: '请输入新密码' },
                { min: 8, message: '密码至少 8 位' },
                { max: 72, message: '密码最多 72 位' },
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Form.Item
              name="confirm"
              label="确认新密码"
              dependencies={['newPassword']}
              rules={[
                { required: true, message: '请再次输入新密码' },
                ({ getFieldValue }) => ({
                  validator: (_, value) =>
                    !value || value === getFieldValue('newPassword')
                      ? Promise.resolve()
                      : Promise.reject(new Error('两次输入的新密码不一致')),
                }),
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={changePassword.isPending}>
              修改密码
            </Button>
          </Form>
        </Card>

        <Card title="在 Claude Code 中接入缺陷平台" style={{ marginBottom: 16 }}>
          <Typography.Paragraph>
            1. 在下方创建一个个人 Token；2. 在终端执行接入命令；3. 在项目目录打开 Claude Code，输入
            <Typography.Text code>/mcp__defects__fix_bug 缺陷编号</Typography.Text> 或直接说“修复
            APP-12”。
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Token 的权限与你在各项目中的角色一致；只读 Token 只能查看缺陷，不能回写评论与状态。Token
            相当于密码，不要提交到代码仓库。
          </Typography.Paragraph>
        </Card>

        <Card
          title="个人 API Token"
          extra={
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
              创建 Token
            </Button>
          }
        >
          <Table<ApiTokenItem>
            rowKey="id"
            size="small"
            loading={tokens.isLoading}
            dataSource={tokens.data ?? []}
            pagination={false}
            columns={[
              { title: '名称', dataIndex: 'name' },
              {
                title: '前缀',
                dataIndex: 'prefix',
                render: (v: string) => <Typography.Text code>{v}…</Typography.Text>,
              },
              {
                title: '权限',
                dataIndex: 'readOnly',
                render: (v: boolean) => (v ? <Tag>只读</Tag> : <Tag color="blue">读写</Tag>),
              },
              {
                title: '最近使用',
                dataIndex: 'lastUsedAt',
                render: (v: string | null) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '从未'),
              },
              {
                title: '',
                width: 80,
                render: (_, t) => (
                  <Popconfirm
                    title="吊销后使用该 Token 的 Claude Code 将无法访问"
                    onConfirm={() => revoke.mutate(t.id)}
                  >
                    <Button type="link" size="small" danger>
                      吊销
                    </Button>
                  </Popconfirm>
                ),
              },
            ]}
          />
        </Card>
      </div>

      <Modal
        title="创建 Token"
        open={creating}
        onCancel={() => setCreating(false)}
        footer={null}
        destroyOnHidden
      >
        <Form
          layout="vertical"
          onFinish={(v) => create.mutate(v)}
          initialValues={{ name: 'Claude Code' }}
        >
          <Form.Item name="name" label="名称" rules={[{ required: true, max: 50 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="readOnly" valuePropName="checked">
            <Checkbox>只读（只能查看缺陷，不能回写）</Checkbox>
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={create.isPending}>
            创建
          </Button>
        </Form>
      </Modal>

      <Modal
        title="Token 已创建"
        open={!!newToken}
        onCancel={() => setNewToken(null)}
        footer={<Button onClick={() => setNewToken(null)}>我已保存</Button>}
        width={720}
      >
        <Alert
          type="warning"
          showIcon
          message="Token 只显示这一次，请立即复制保存"
          style={{ marginBottom: 12 }}
        />
        {newToken && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Space.Compact style={{ width: '100%' }}>
              <Input readOnly value={newToken} />
              <Button icon={<CopyOutlined />} onClick={() => void copy(newToken)}>
                复制 Token
              </Button>
            </Space.Compact>
            <Typography.Text>
              在终端执行以下命令接入（Claude Code 会把它保存在本机配置中）：
            </Typography.Text>
            <Space.Compact style={{ width: '100%' }}>
              <Input readOnly value={addCmd(newToken)} />
              <Button icon={<CopyOutlined />} onClick={() => void copy(addCmd(newToken))}>
                复制命令
              </Button>
            </Space.Compact>
          </Space>
        )}
      </Modal>
    </div>
  );
}
