import {
  ApartmentOutlined,
  ApiOutlined,
  BranchesOutlined,
  CopyOutlined,
  EyeOutlined,
  MobileOutlined,
  TagsOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { POSITION, PROJECT_ROLE, PROJECT_ROLES } from '@defect/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  App,
  Alert,
  Button,
  Card,
  Form,
  Grid,
  Input,
  Menu,
  Modal,
  Popconfirm,
  Result,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { qk, useProject } from '../api/hooks';
import type { Member, ModuleItem, ProjectDetail, VersionItem } from '../api/types';
import { userName } from '../components/UserNames';
import { FieldSettings } from './settings/FieldSettings';
import { WorkflowSettings } from './settings/WorkflowSettings';
import { copyText } from '../components/clipboard';

const roleOptions = PROJECT_ROLES.map((r) => ({ value: r, label: PROJECT_ROLE[r] }));

/** 项目设置的二级菜单：一次只编辑一类配置 */
const SETTINGS_TABS = [
  { key: 'members', label: '成员与角色', icon: <TeamOutlined /> },
  { key: 'workflow', label: '缺陷状态', icon: <BranchesOutlined /> },
  { key: 'fields', label: '字段显示', icon: <EyeOutlined /> },
  { key: 'modules', label: '模块与负责人', icon: <ApartmentOutlined /> },
  { key: 'versions', label: '版本', icon: <TagsOutlined /> },
  { key: 'apps', label: 'APP 绑定', icon: <MobileOutlined /> },
  { key: 'integration', label: '集成', icon: <ApiOutlined /> },
];

export function SettingsPage() {
  const { key = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const mobile = !Grid.useBreakpoint().md;
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
  // 项目设置只对项目管理员开放；侧边栏不显示入口，直接输入地址进来的也拦住
  if (!isAdmin)
    return (
      <Result
        status="403"
        title="只有项目管理员可以访问项目设置"
        subTitle="需要调整模块、版本、成员或工作流时，请联系项目管理员。"
        extra={<Link to={`/p/${key}/bugs`}>返回缺陷列表</Link>}
      />
    );
  // 集成（Webhook 密钥）只有项目管理员能看到
  const tabs = SETTINGS_TABS.filter((t) => t.key !== 'integration' || (isAdmin && project.webhook));
  const requested = params.get('tab');
  const tab = tabs.some((t) => t.key === requested) ? requested! : tabs[0]!.key;

  return (
    <div>
      <Typography.Title level={4}>项目设置 · {project.name}</Typography.Title>

      <div className="settings-layout">
        <nav className="settings-nav">
          <Menu
            mode={mobile ? 'horizontal' : 'inline'}
            selectedKeys={[tab]}
            items={tabs.map((t) => ({ key: t.key, icon: t.icon, label: t.label }))}
            onClick={({ key: k }) => setParams({ tab: k }, { replace: true })}
          />
        </nav>
        <div style={{ minWidth: 0 }}>
          {tab === 'members' && (
            <Card title="成员与角色">
              <Table<Member>
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={project.members}
                columns={[
                  { title: '姓名', dataIndex: 'name' },
                  { title: '账号', dataIndex: 'username' },
                  {
                    title: '职位',
                    dataIndex: 'position',
                    render: (v: Member['position']) => (v ? POSITION[v] : '—'),
                  },
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
                          onChange={(r) =>
                            void mutate('/members', 'POST', { account: m.username, role: r })
                          }
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
                          onConfirm={() =>
                            void mutate(`/members/${m.id}`, 'DELETE', undefined, '已移出')
                          }
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
                    name="account"
                    rules={[{ required: true, whitespace: true, message: '请输入账号或邮箱' }]}
                  >
                    <Input placeholder="账号或邮箱（需已审核通过）" style={{ width: 240 }} />
                  </Form.Item>
                  <Form.Item name="role">
                    <Select
                      options={roleOptions}
                      allowClear
                      placeholder="按职位默认"
                      style={{ width: 140 }}
                    />
                  </Form.Item>
                  <Button htmlType="submit">添加成员</Button>
                </Form>
              )}
            </Card>
          )}

          {tab === 'modules' && (
            <Card
              title="模块与负责人"
              extra={
                <Typography.Text type="secondary">确认缺陷时自动指派给模块负责人</Typography.Text>
              }
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
          )}

          {tab === 'versions' && (
            <Card
              title="版本"
              extra={
                <Typography.Text type="secondary">
                  版本关联 Git commit，Claude 据此对照代码
                </Typography.Text>
              }
            >
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                <Typography.Text>当前迭代版本</Typography.Text>
                <Select
                  allowClear
                  size="small"
                  placeholder="未设置"
                  disabled={!isAdmin}
                  style={{ width: 160 }}
                  value={project.fixVersionId ?? undefined}
                  options={project.versions.map((v) => ({ value: v.id, label: v.name }))}
                  onChange={(v?: string) => void mutate('', 'PATCH', { fixVersionId: v ?? null })}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  MR 合并、缺陷自动转为已解决时，填入这个版本作为修复版本
                </Typography.Text>
              </div>
              <Table<VersionItem>
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={project.versions}
                columns={[
                  {
                    title: '版本',
                    dataIndex: 'name',
                    render: (name: string, v) => (
                      <span>
                        {name}
                        {v.id === project.fixVersionId && (
                          <Tag color="processing" bordered={false} style={{ marginInlineStart: 6 }}>
                            当前迭代
                          </Tag>
                        )}
                      </span>
                    ),
                  },
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
          )}

          {tab === 'apps' && (
            <Card
              title="APP 绑定"
              extra={
                <Typography.Text type="secondary">
                  这些包名的 APP 反馈会自动建单到本项目
                </Typography.Text>
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
          )}

          {tab === 'workflow' && <WorkflowSettings project={project} editable={isAdmin} />}
          {tab === 'fields' && <FieldSettings project={project} editable={isAdmin} />}

          {tab === 'integration' && project.webhook && (
            <IntegrationCard projectKey={key} webhook={project.webhook} onChanged={refresh} />
          )}
        </div>
      </div>
    </div>
  );
}

/** 集成：Git 平台 Webhook（方案 7.7），MR 合并后自动关联提交并把缺陷流转为已解决 */
function IntegrationCard({
  projectKey,
  webhook,
  onChanged,
}: {
  projectKey: string;
  webhook: NonNullable<ProjectDetail['webhook']>;
  onChanged: () => void;
}) {
  const { message } = App.useApp();
  const [secret, setSecret] = useState<string | null>(null);
  const reset = useMutation({
    mutationFn: () =>
      api<{ url: string; secret: string }>(`/projects/${projectKey}/webhook-secret`, {
        method: 'POST',
      }),
    onSuccess: (res) => {
      setSecret(res.secret);
      onChanged();
    },
    onError: (e: Error) => message.error(e.message),
  });
  const copy = async (text: string) => {
    if (await copyText(text)) message.success('已复制');
    else message.warning({ content: `复制失败，请手动复制：${text}`, duration: 8 });
  };

  return (
    <Card
      title="集成"
      extra={
        <Typography.Text type="secondary">
          Git Webhook：自动关联提交与 MR，MR 合并后缺陷自动变为已解决
        </Typography.Text>
      }
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Typography.Text strong>Webhook 地址（GitHub、GitLab 通用）</Typography.Text>
        <Space.Compact style={{ width: '100%' }}>
          <Input readOnly value={webhook.url} />
          <Button icon={<CopyOutlined />} onClick={() => void copy(webhook.url)}>
            复制
          </Button>
        </Space.Compact>
        <Space>
          <Typography.Text strong>密钥</Typography.Text>
          {webhook.secretConfigured ? <Tag color="green">已配置</Tag> : <Tag>未配置</Tag>}
          {webhook.secretConfigured ? (
            <Popconfirm
              title="重置密钥？"
              description="旧密钥立即失效，需同步更新 Git 平台上的 Webhook 配置"
              onConfirm={() => reset.mutate()}
            >
              <Button loading={reset.isPending}>重置密钥</Button>
            </Popconfirm>
          ) : (
            <Button type="primary" loading={reset.isPending} onClick={() => reset.mutate()}>
              生成密钥
            </Button>
          )}
        </Space>
        <Typography.Text type="secondary">
          GitHub：Content type 选 application/json，Secret 填密钥，事件勾选 Pushes 与 Pull
          requests。GitLab：Secret token 填密钥，勾选 Push events 与 Merge request
          events。分支名、提交信息或 MR 标题中写缺陷编号（如 fix({projectKey}-12): …）即可关联。
        </Typography.Text>
      </Space>

      <Modal
        title="Webhook 密钥已生成"
        open={!!secret}
        onCancel={() => setSecret(null)}
        footer={<Button onClick={() => setSecret(null)}>我已保存</Button>}
        width={640}
      >
        <Alert
          type="warning"
          showIcon
          message="密钥只显示这一次，请立即填到 Git 平台的 Webhook 配置中"
          style={{ marginBottom: 12 }}
        />
        {secret && (
          <Space.Compact style={{ width: '100%' }}>
            <Input readOnly value={secret} />
            <Button icon={<CopyOutlined />} onClick={() => void copy(secret)}>
              复制密钥
            </Button>
          </Space.Compact>
        )}
      </Modal>
    </Card>
  );
}
