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
  Tabs,
  Tag,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import { useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { qk } from '../api/hooks';
import type { ApiTokenItem } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { copyText } from '../components/clipboard';

interface PasswordValues {
  oldPassword: string;
  newPassword: string;
  confirm: string;
}

const mcpUrl = () => `${window.location.origin}/api/v1/mcp`;
const TOKEN_PLACEHOLDER = '<你的Token>';

/** 接入命令与配置片段；token 为空时用占位符，提示用户替换 */
const addCmd = (token: string) =>
  `claude mcp add -s user --transport http defects ${mcpUrl()} --header "Authorization: Bearer ${token}"`;
const removeCmd = 'claude mcp remove -s user defects';
const configJson = (token: string) =>
  JSON.stringify(
    {
      mcpServers: {
        defects: {
          type: 'http',
          url: mcpUrl(),
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );

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
  // 本次打开页面时新建的 Token：填进下面的接入命令里，刷新页面后不再保留
  const [sessionToken, setSessionToken] = useState<string | null>(null);
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
      setSessionToken(res.token);
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
    if (await copyText(text)) message.success('已复制');
    else message.warning({ content: `复制失败，请手动复制：${text}`, duration: 8 });
  };
  const token = sessionToken ?? TOKEN_PLACEHOLDER;
  const code = (text: string) => <CodeBlock text={text} onCopy={copy} />;

  return (
    <div>
      <Typography.Title level={4}>个人设置</Typography.Title>
      <div className="me-layout">
        <div className="me-side">
          <Card title="账号">
            <Typography.Paragraph style={{ marginBottom: 4 }}>
              {user?.name}
              {user?.isSystemAdmin && (
                <Tag color="gold" style={{ marginLeft: 8 }}>
                  系统管理员
                </Tag>
              )}
            </Typography.Paragraph>
            <Typography.Text type="secondary">
              账号 {user?.username}
              {user?.email ? ` · ${user.email}` : ''}
            </Typography.Text>
          </Card>

          <Card title="修改密码">
            <Form<PasswordValues>
              form={pwdForm}
              layout="vertical"
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
        </div>

        <Card title="接入 Claude Code（MCP）" className="me-main">
          <Typography.Paragraph type="secondary">
            接入后，你在本地用 Claude Code
            修缺陷时，它能直接读取缺陷的描述、截图、录屏关键帧和日志，修完后还能回写评论、流转状态。每人只需配置一次，所有项目通用。
          </Typography.Paragraph>

          <GuideSection
            step={1}
            title="创建个人 Token"
            extra={
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
                创建 Token
              </Button>
            }
          >
            <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
              Token 代表你本人：Claude
              的操作都会记在你名下，权限与你在各项目中的角色一致。请每人创建自己的
              Token，不要共用，也不要提交到代码仓库。勾选“只读”时只能查看缺陷，不能回写评论和状态。
            </Typography.Paragraph>
            <Table<ApiTokenItem>
              rowKey="id"
              size="small"
              loading={tokens.isLoading}
              dataSource={tokens.data ?? []}
              pagination={false}
              locale={{ emptyText: '还没有 Token，点右上角“创建 Token”' }}
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
          </GuideSection>

          <GuideSection step={2} title="按你的安装情况配置 MCP">
            {sessionToken ? (
              <Alert
                type="success"
                showIcon
                message="下面的命令和配置已填入你刚创建的 Token，可以直接复制使用"
                style={{ marginBottom: 12 }}
              />
            ) : (
              <Alert
                type="info"
                showIcon
                message={`请把下面命令和配置里的 ${TOKEN_PLACEHOLDER} 换成第 1 步创建的 Token（Token 只在创建时显示一次；忘了就吊销后重新创建）`}
                style={{ marginBottom: 12 }}
              />
            )}
            <Tabs
              items={[
                {
                  key: 'cli',
                  label: '装了 Claude Code 命令行',
                  children: (
                    <Steps>
                      <li>
                        打开终端（Windows 用 cmd 或 PowerShell，Mac 用“终端”），先确认命令可用：
                        {code('claude --version')}
                        能显示版本号就继续；提示“不是内部或外部命令”说明没装命令行，请看另外两个页签。
                      </li>
                      <li>
                        运行接入命令（<Typography.Text code>-s user</Typography.Text>
                        表示保存到用户级配置，在任何项目目录打开都能用）：
                        {code(addCmd(token))}
                      </li>
                      <li>
                        确认接入成功：
                        {code('claude mcp list')}
                        列表里有 defects 且状态正常即可。
                      </li>
                      <li>
                        如果提示 <Typography.Text code>already exists</Typography.Text>
                        （以前接入过，比如换了新 Token），先删掉旧配置再运行第 2 步：
                        {code(removeCmd)}
                      </li>
                    </Steps>
                  ),
                },
                {
                  key: 'desktop',
                  label: '只装了 Claude 桌面版',
                  children: (
                    <Steps>
                      <li>
                        桌面版里修代码用的是左侧的 <Typography.Text strong>Code</Typography.Text>
                        功能，它内置了 Claude Code，和命令行共用同一份用户配置文件
                        <Typography.Text code>.claude.json</Typography.Text>
                        。普通聊天（Chat）不读取这份配置，请在 Code 里使用。
                      </li>
                      <li>
                        完全退出 Claude 桌面版（Windows 右下角托盘图标右键退出，Mac 用 Cmd+Q）。
                      </li>
                      <li>
                        用记事本或任意文本编辑器打开配置文件，没有就新建一个：
                        <ul className="guide-sub">
                          <li>
                            Windows：在文件资源管理器地址栏输入
                            <Typography.Text code>%USERPROFILE%\.claude.json</Typography.Text>
                            回车（即 C:\Users\你的用户名\.claude.json）
                          </li>
                          <li>
                            Mac：在“终端”运行
                            <Typography.Text code>open -e ~/.claude.json</Typography.Text>
                            （文件不存在时先运行{' '}
                            <Typography.Text code>touch ~/.claude.json</Typography.Text>）
                          </li>
                        </ul>
                        改之前建议先复制一份备份，文件改坏会导致 Claude 无法启动。
                      </li>
                      <li>
                        把 defects 这一项加到文件最外层的{' '}
                        <Typography.Text code>mcpServers</Typography.Text>{' '}
                        里，保留文件里原有的其他内容：
                        <ul className="guide-sub">
                          <li>文件是新建的（空文件）：直接粘贴下面全部内容。</li>
                          <li>
                            文件已有内容但没有 mcpServers：在第一个
                            <Typography.Text code>{'{'}</Typography.Text>
                            后面插入下面花括号里的{' '}
                            <Typography.Text code>"mcpServers": {'{ … }'}</Typography.Text>
                            ，并在它后面加一个英文逗号。
                          </li>
                          <li>
                            已有 mcpServers：只把其中的{' '}
                            <Typography.Text code>"defects": {'{ … }'}</Typography.Text>{' '}
                            加进去，和其他服务之间用英文逗号隔开。
                          </li>
                        </ul>
                        {code(configJson(token))}
                      </li>
                      <li>
                        保存文件，重新打开 Claude 桌面版，新建一个 Code
                        会话（已开着的会话不会加载新配置）。
                      </li>
                    </Steps>
                  ),
                },
                {
                  key: 'ide',
                  label: 'VS Code / Cursor 等编辑器插件',
                  children: (
                    <Steps>
                      <li>
                        VS Code、Cursor、JetBrains 等编辑器里的 Claude Code
                        插件，和命令行共用同一份用户配置，配置一次所有编辑器都能用。
                      </li>
                      <li>
                        在编辑器里打开内置终端（VS Code / Cursor：菜单“终端 → 新建终端”，快捷键
                        Ctrl+`），先试一下：
                        {code('claude --version')}
                      </li>
                      <li>
                        能显示版本号：直接在这个终端运行接入命令：
                        {code(addCmd(token))}
                        提示 <Typography.Text code>already exists</Typography.Text> 时先运行{' '}
                        <Typography.Text code>{removeCmd}</Typography.Text> 再接入。
                      </li>
                      <li>
                        提示找不到 claude 命令：按“只装了 Claude 桌面版”页签第 3、4 步，手动编辑
                        <Typography.Text code>.claude.json</Typography.Text> 配置文件。
                      </li>
                      <li>
                        重新加载编辑器后再打开 Claude 面板：VS Code / Cursor 按
                        Ctrl+Shift+P（Mac：Cmd+Shift+P）运行
                        <Typography.Text code>Developer: Reload Window</Typography.Text>
                        ；JetBrains 系列直接重启 IDE。
                      </li>
                    </Steps>
                  ),
                },
              ]}
            />
          </GuideSection>

          <GuideSection step={3} title="开始使用">
            <Steps>
              <li>
                在你的项目代码目录打开 Claude Code，新开一个会话（命令行、桌面版
                Code、编辑器插件都可以）。
              </li>
              <li>
                输入下面的命令（把缺陷编号换成要修的那个），或者直接说“修复 APP-12”：
                {code('/mcp__defects__fix_bug APP-12')}
              </li>
              <li>Claude 会先读取缺陷材料、分析根因并告诉你修复方案，你确认后它才改代码。</li>
              <li>
                连不上时：确认电脑能打开{' '}
                <Typography.Text code>{window.location.origin}</Typography.Text>
                ，Token 没有被吊销；换了 Token 要按第 2 步重新配置。
              </li>
            </Steps>
          </GuideSection>
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
            <Typography.Text type="secondary">
              关闭后，页面上第 2 步的命令和配置会自动填入这个 Token，按你的安装情况复制使用即可。
            </Typography.Text>
          </Space>
        )}
      </Modal>
    </div>
  );
}

function GuideSection({
  step,
  title,
  extra,
  children,
}: {
  step: number;
  title: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="guide-section">
      <div className="guide-head">
        <span className="guide-step mono">{step}</span>
        <Typography.Text strong style={{ fontSize: 15 }}>
          {title}
        </Typography.Text>
        <div style={{ flex: 1 }} />
        {extra}
      </div>
      {children}
    </section>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="guide-steps">{children}</ol>;
}

/** 可复制的命令 / 配置块 */
function CodeBlock({ text, onCopy }: { text: string; onCopy: (t: string) => void }) {
  return (
    <div className="cmd-block">
      <pre className="mono">{text}</pre>
      <Button
        size="small"
        type="text"
        icon={<CopyOutlined />}
        aria-label="复制"
        onClick={() => onCopy(text)}
      />
    </div>
  );
}
