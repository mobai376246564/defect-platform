import { PROJECT_ROLE, PROJECT_ROLES } from '@defect/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Alert,
  Button,
  Card,
  Form,
  Input,
  Popconfirm,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import { qk, useProject } from '../api/hooks';
import type { Member, ModuleItem, VersionItem } from '../api/types';
import { userName } from '../components/UserNames';

const roleOptions = PROJECT_ROLES.map((r) => ({ value: r, label: PROJECT_ROLE[r] }));

export function SettingsPage() {
  const { key = '' } = useParams();
  const { data: project } = useProject(key);
  const { message } = App.useApp();
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.project(key) });
  const mutate = (path: string, method: string, body?: unknown, ok = '已保存') =>
    api(`/projects/${key}${path}`, { method, body })
      .then(() => {
        message.success(ok);
        refresh();
      })
      .catch((e: Error) => message.error(e.message));

  const saveApps = useMutation({
    mutationFn: (appIds: string[]) =>
      api(`/projects/${key}`, { method: 'PATCH', body: { appIds } }),
    onSuccess: () => {
      message.success('已保存');
      refresh();
    },
    onError: (e: Error) => message.error(e.message),
  });

  if (!project) return <Skeleton active />;
  const isAdmin = project.myRole === 'admin';

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <Typography.Title level={4}>项目设置 · {project.name}</Typography.Title>
      {!isAdmin && (
        <Alert
          type="info"
          showIcon
          message="只有项目管理员可以修改设置"
          style={{ marginBottom: 16 }}
        />
      )}

      <Card title="成员与角色" style={{ marginBottom: 16 }}>
        <Table<Member>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={project.members}
          columns={[
            { title: '姓名', dataIndex: 'name' },
            { title: '邮箱', dataIndex: 'email' },
            {
              title: '角色',
              dataIndex: 'role',
              render: (role: Member['role'], m) =>
                isAdmin ? (
                  <Select
                    size="small"
                    value={role}
                    options={roleOptions}
                    style={{ width: 120 }}
                    onChange={(r) => void mutate('/members', 'POST', { email: m.email, role: r })}
                  />
                ) : (
                  <Tag>{PROJECT_ROLE[role]}</Tag>
                ),
            },
            {
              title: '',
              width: 80,
              render: (_, m) =>
                isAdmin && (
                  <Popconfirm
                    title={`移出 ${m.name}？`}
                    onConfirm={() => void mutate(`/members/${m.id}`, 'DELETE', undefined, '已移出')}
                  >
                    <Button size="small" type="link" danger>
                      移出
                    </Button>
                  </Popconfirm>
                ),
            },
          ]}
        />
        {isAdmin && (
          <Form
            layout="inline"
            style={{ marginTop: 12 }}
            onFinish={(v) => void mutate('/members', 'POST', v, '已添加')}
          >
            <Form.Item
              name="email"
              rules={[{ required: true, type: 'email', message: '请输入邮箱' }]}
            >
              <Input placeholder="成员邮箱（需已有账号）" style={{ width: 240 }} />
            </Form.Item>
            <Form.Item name="role" initialValue="developer">
              <Select options={roleOptions} style={{ width: 120 }} />
            </Form.Item>
            <Button htmlType="submit">添加成员</Button>
          </Form>
        )}
      </Card>

      <Card
        title="模块与负责人"
        extra={<Typography.Text type="secondary">确认缺陷时自动指派给模块负责人</Typography.Text>}
        style={{ marginBottom: 16 }}
      >
        <Table<ModuleItem>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={project.modules}
          columns={[
            { title: '模块', dataIndex: 'name' },
            {
              title: '负责人',
              dataIndex: 'ownerId',
              render: (ownerId: string | null, m) =>
                isAdmin ? (
                  <Select
                    size="small"
                    allowClear
                    style={{ width: 160 }}
                    value={ownerId ?? undefined}
                    options={project.members.map((x) => ({ value: x.id, label: x.name }))}
                    onChange={(v?: string) =>
                      void mutate(`/modules/${m.id}`, 'PATCH', { ownerId: v ?? null })
                    }
                  />
                ) : (
                  userName(project.members, ownerId)
                ),
            },
          ]}
        />
        {isAdmin && (
          <Form
            layout="inline"
            style={{ marginTop: 12 }}
            onFinish={(v) => void mutate('/modules', 'POST', v, '已添加')}
          >
            <Form.Item name="name" rules={[{ required: true, message: '请输入模块名' }]}>
              <Input placeholder="模块名" />
            </Form.Item>
            <Form.Item name="ownerId">
              <Select
                allowClear
                placeholder="负责人"
                style={{ width: 160 }}
                options={project.members.map((x) => ({ value: x.id, label: x.name }))}
              />
            </Form.Item>
            <Button htmlType="submit">添加模块</Button>
          </Form>
        )}
      </Card>

      <Card
        title="版本"
        extra={
          <Typography.Text type="secondary">
            版本关联 Git commit，Claude 据此对照代码
          </Typography.Text>
        }
        style={{ marginBottom: 16 }}
      >
        <Table<VersionItem>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={project.versions}
          columns={[
            { title: '版本', dataIndex: 'name' },
            { title: 'Build', dataIndex: 'build', render: (v) => v ?? '—' },
            {
              title: 'Git commit',
              dataIndex: 'commit',
              render: (v) => (v ? <Typography.Text code>{v}</Typography.Text> : '—'),
            },
          ]}
        />
        {isAdmin && (
          <Form
            layout="inline"
            style={{ marginTop: 12 }}
            onFinish={(v) => void mutate('/versions', 'POST', v, '已添加')}
          >
            <Form.Item name="name" rules={[{ required: true, message: '请输入版本号' }]}>
              <Input placeholder="3.12.1" />
            </Form.Item>
            <Form.Item name="build">
              <Input placeholder="Build 号" />
            </Form.Item>
            <Form.Item name="commit">
              <Input placeholder="Git commit" />
            </Form.Item>
            <Button htmlType="submit">添加版本</Button>
          </Form>
        )}
      </Card>

      <Card
        title="APP 绑定"
        extra={
          <Typography.Text type="secondary">这些包名的 APP 反馈会自动建单到本项目</Typography.Text>
        }
      >
        <Space.Compact style={{ width: '100%' }}>
          <Select
            mode="tags"
            open={false}
            disabled={!isAdmin}
            style={{ flex: 1 }}
            defaultValue={project.appIds}
            onChange={(v: string[]) => saveApps.mutate(v)}
            placeholder="com.example.app"
          />
        </Space.Compact>
      </Card>
    </div>
  );
}
