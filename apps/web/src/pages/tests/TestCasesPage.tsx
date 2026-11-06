import {
  CopyOutlined,
  ImportOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import {
  hasPermission,
  TEST_CASE_MODE,
  TEST_CASE_MODE_OPTIONS,
  TEST_CASE_STATUS,
  TEST_CASE_STATUS_OPTIONS,
} from '@defect/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { qk, useProject, useTestCaseModules, useTestCases } from '../../api/hooks';
import type { TestCaseItem, TestRunItem } from '../../api/types';
import { copyText } from '../../components/clipboard';
import { TestCaseDrawer } from './TestCaseDrawer';
import { TestsNav } from './TestsNav';

const STATUS_COLOR: Record<TestCaseItem['status'], string> = {
  draft: 'gold',
  approved: 'green',
  obsolete: 'default',
};

/** 用例库：Claude 生成或手写的用例在这里审核、编辑，勾选后开始一次执行 */
export function TestCasesPage() {
  const { key = '' } = useParams();
  const project = useProject(key);
  const canManage = hasPermission(project.data?.myRole, 'test.manage');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();

  const [query, setQuery] = useState<{
    keyword?: string;
    module?: string;
    status?: string;
    mode?: string;
    page: number;
    pageSize: number;
  }>({ page: 1, pageSize: 50 });
  const cases = useTestCases(key, query);
  const modules = useTestCaseModules(key);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<TestCaseItem | null | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);

  const refresh = () => void qc.invalidateQueries({ queryKey: qk.tests(key) });
  const patchQuery = (p: Partial<typeof query>) => setQuery((q) => ({ ...q, ...p, page: 1 }));

  /** 批量审核 / 废弃 / 退回 / 删除 */
  const bulk = async (action: 'approve' | 'obsolete' | 'draft' | 'delete') => {
    try {
      const res = await api<{ count: number }>(`/projects/${key}/tests/cases/bulk`, {
        method: 'POST',
        body: { ids: selected, action },
      });
      message.success(`已处理 ${res.count} 条`);
      setSelected([]);
      refresh();
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const columns: ColumnsType<TestCaseItem> = [
    {
      title: '编号',
      dataIndex: 'code',
      width: 90,
      render: (v: string) => <span className="mono">{v}</span>,
    },
    { title: '模块', dataIndex: 'module', width: 160, ellipsis: true },
    {
      title: '标题',
      dataIndex: 'title',
      ellipsis: true,
      render: (v: string, r) => (
        <Typography.Link onClick={() => setEditing(r)} ellipsis>
          {v}
        </Typography.Link>
      ),
    },
    { title: '优先级', dataIndex: 'priority', width: 76 },
    {
      title: '执行方式',
      dataIndex: 'mode',
      width: 96,
      render: (v: TestCaseItem['mode'], r) =>
        v === 'manual' ? (
          <Tooltip title={r.manualReason || '未写原因'}>
            <Tag color="purple">{TEST_CASE_MODE[v]}</Tag>
          </Tooltip>
        ) : (
          <Tag color="blue">{TEST_CASE_MODE[v]}</Tag>
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: TestCaseItem['status']) => (
        <Tag color={STATUS_COLOR[v]}>{TEST_CASE_STATUS[v]}</Tag>
      ),
    },
    {
      title: '来源',
      dataIndex: 'origin',
      width: 80,
      render: (v: TestCaseItem['origin']) =>
        v === 'ai' ? <Tag icon={<RobotOutlined />}>AI</Tag> : <Tag>人工</Tag>,
    },
  ];

  return (
    <div className="page">
      <TestsNav projectKey={key} projectName={project.data?.name} active="cases">
        <Tooltip title="刷新">
          <Button icon={<ReloadOutlined />} aria-label="刷新" onClick={refresh} />
        </Tooltip>
        {canManage && (
          <>
            <Button icon={<RobotOutlined />} onClick={() => setGenOpen(true)}>
              用 Claude 生成
            </Button>
            <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>
              导入
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing(null)}>
              新建用例
            </Button>
          </>
        )}
      </TestsNav>

      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search
          allowClear
          placeholder="标题 / 模块 / 编号"
          style={{ width: 220 }}
          onSearch={(v) => patchQuery({ keyword: v || undefined })}
        />
        <Select
          allowClear
          placeholder="模块"
          style={{ width: 200 }}
          value={query.module}
          options={(modules.data ?? []).map((m) => ({
            value: m.module,
            label: `${m.module || '（未分模块）'} · ${m.count}`,
          }))}
          onChange={(v?: string) => patchQuery({ module: v })}
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 110 }}
          options={TEST_CASE_STATUS_OPTIONS}
          onChange={(v?: string) => patchQuery({ status: v })}
        />
        <Select
          allowClear
          placeholder="执行方式"
          style={{ width: 110 }}
          options={TEST_CASE_MODE_OPTIONS}
          onChange={(v?: string) => patchQuery({ mode: v })}
        />
        {canManage && selected.length > 0 && (
          <>
            <Typography.Text type="secondary">已选 {selected.length} 条</Typography.Text>
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => setRunOpen(true)}>
              执行所选
            </Button>
            <Button onClick={() => void bulk('approve')}>审核通过</Button>
            <Button onClick={() => void bulk('draft')}>退回待审核</Button>
            <Button onClick={() => void bulk('obsolete')}>废弃</Button>
            <Popconfirm
              title={`删除 ${selected.length} 条用例？`}
              description="执行记录里对应的结果也会一起删除。"
              okText="删除"
              okButtonProps={{ danger: true }}
              onConfirm={() => void bulk('delete')}
            >
              <Button danger>删除</Button>
            </Popconfirm>
          </>
        )}
      </Space>

      <Table<TestCaseItem>
        rowKey="id"
        size="middle"
        loading={cases.isFetching}
        columns={columns}
        dataSource={cases.data?.items}
        rowSelection={
          canManage
            ? { selectedRowKeys: selected, onChange: (keys) => setSelected(keys as string[]) }
            : undefined
        }
        expandable={{
          expandedRowRender: (r) => <CaseBrief value={r} />,
        }}
        pagination={{
          current: query.page,
          pageSize: query.pageSize,
          total: cases.data?.total,
          showSizeChanger: true,
          pageSizeOptions: [20, 50, 100, 200],
          showTotal: (t) => `共 ${t} 条`,
          onChange: (page, pageSize) => setQuery((q) => ({ ...q, page, pageSize })),
        }}
      />

      <TestCaseDrawer
        projectKey={key}
        value={editing ?? null}
        open={editing !== undefined}
        canEdit={canManage}
        modules={modules.data ?? []}
        onClose={() => setEditing(undefined)}
      />
      <ImportModal projectKey={key} open={importOpen} onClose={() => setImportOpen(false)} />
      <GenerateModal projectKey={key} open={genOpen} onClose={() => setGenOpen(false)} />
      <CreateRunModal
        projectKey={key}
        caseIds={selected}
        open={runOpen}
        onClose={() => setRunOpen(false)}
        onCreated={(run) => {
          setSelected([]);
          void navigate(`/p/${key}/tests/runs/${run.id}`);
        }}
      />
    </div>
  );
}

/** 展开行：前置条件、步骤、预期、测试数据 */
export function CaseBrief({
  value,
}: {
  value: Pick<TestCaseItem, 'precondition' | 'steps' | 'expected' | 'testData' | 'env'> & {
    source?: string;
  };
}) {
  const row = (label: string, node: ReactNode) => (
    <div style={{ display: 'flex', gap: 12, marginBottom: 6 }}>
      <Typography.Text type="secondary" style={{ flex: '0 0 64px' }}>
        {label}
      </Typography.Text>
      <div style={{ flex: 1, minWidth: 0 }}>{node}</div>
    </div>
  );
  return (
    <div style={{ padding: '4px 8px' }}>
      {value.precondition && row('前置条件', value.precondition)}
      {row(
        '步骤',
        <ol style={{ margin: 0, paddingLeft: 18 }}>
          {value.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>,
      )}
      {row(
        '预期',
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {value.expected.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>,
      )}
      {value.testData && row('测试数据', value.testData)}
      {value.env && row('适用环境', value.env)}
      {value.source && row('来源', value.source)}
    </div>
  );
}

/** 导入用例：粘贴或选择 JSON（数组，或 { source, cases } 形式的 Claude 生成稿） */
function ImportModal({
  projectKey,
  open,
  onClose,
}: {
  projectKey: string;
  open: boolean;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [textValue, setTextValue] = useState('');
  const [origin, setOrigin] = useState<'ai' | 'manual'>('ai');
  const [saving, setSaving] = useState(false);

  /** 解析出用例数组与整批来源；格式不对返回错误说明 */
  const parsed = useMemo((): { cases: unknown[]; source?: string } | string | null => {
    if (!textValue.trim()) return null;
    try {
      const data: unknown = JSON.parse(textValue);
      if (Array.isArray(data)) return { cases: data };
      const obj = data as { cases?: unknown; source?: unknown };
      if (obj && Array.isArray(obj.cases)) {
        return {
          cases: obj.cases,
          source: typeof obj.source === 'string' ? obj.source.slice(0, 500) : undefined,
        };
      }
      return '需要用例数组，或带 cases 数组的对象';
    } catch {
      return 'JSON 格式不正确';
    }
  }, [textValue]);

  const submit = async () => {
    if (!parsed || typeof parsed === 'string') return;
    setSaving(true);
    try {
      const res = await api<{ count: number; codes: string[] }>(
        `/projects/${projectKey}/tests/cases/import`,
        { method: 'POST', body: { ...parsed, origin } },
      );
      message.success(`已导入 ${res.count} 条，状态为待审核`);
      void qc.invalidateQueries({ queryKey: qk.tests(projectKey) });
      setTextValue('');
      onClose();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="导入用例"
      open={open}
      width={680}
      okText={parsed && typeof parsed !== 'string' ? `导入 ${parsed.cases.length} 条` : '导入'}
      okButtonProps={{ disabled: !parsed || typeof parsed === 'string' }}
      confirmLoading={saving}
      onOk={() => void submit()}
      onCancel={onClose}
    >
      <Typography.Paragraph type="secondary">
        粘贴 JSON 或选择 .json 文件。每条用例需要 title、steps、expected，可带 module、priority、
        precondition、testData、mode（auto / manual 或 自动 /
        人工）、manualReason、env、source。导入后为“待审核”。
      </Typography.Paragraph>
      <Space style={{ marginBottom: 8 }}>
        <Upload
          accept=".json,application/json"
          showUploadList={false}
          beforeUpload={(file) => {
            void file.text().then(setTextValue);
            return false;
          }}
        >
          <Button icon={<ImportOutlined />}>选择文件</Button>
        </Upload>
        <Radio.Group
          value={origin}
          onChange={(e) => setOrigin(e.target.value as 'ai' | 'manual')}
          options={[
            { value: 'ai', label: 'Claude 生成' },
            { value: 'manual', label: '人工编写' },
          ]}
        />
      </Space>
      <Input.TextArea
        value={textValue}
        onChange={(e) => setTextValue(e.target.value)}
        autoSize={{ minRows: 8, maxRows: 16 }}
        className="mono"
        placeholder='[{"title": "…", "steps": ["…"], "expected": ["…"]}]'
      />
      {typeof parsed === 'string' && (
        <Typography.Text type="danger" style={{ display: 'block', marginTop: 6 }}>
          {parsed}
        </Typography.Text>
      )}
    </Modal>
  );
}

/** 用 Claude 生成：给出在 Claude Code 里要输入的命令 */
function GenerateModal({
  projectKey,
  open,
  onClose,
}: {
  projectKey: string;
  open: boolean;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const [source, setSource] = useState('');
  const command = `/mcp__defects__gen_test_cases ${projectKey} ${source.trim() || '<需求文档链接>'}`;
  return (
    <Modal title="用 Claude 生成用例" open={open} footer={null} width={640} onCancel={onClose}>
      <Typography.Paragraph>
        Claude 会读取需求文档，按模块生成用例并写入用例库（待审核），能自动执行的标“自动”，
        需要看硬件、听声音、等定时任务等的标“人工”并写明原因。
      </Typography.Paragraph>
      <ol style={{ paddingLeft: 18 }}>
        <li>
          先在「个人设置与 Claude Code 接入」里创建 Token，按页面命令把平台接入 Claude
          Code（已接入可跳过）。
        </li>
        <li>
          填入需求文档链接（Claude Docs 链接或本地文件路径）：
          <Input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="https://claude.ai/artifact/…"
            style={{ margin: '6px 0' }}
          />
        </li>
        <li>
          在 Claude Code 里输入：
          <Space.Compact style={{ width: '100%', marginTop: 6 }}>
            <Input readOnly value={command} className="mono" />
            <Button
              icon={<CopyOutlined />}
              onClick={() =>
                void copyText(command).then((ok) =>
                  ok ? message.success('已复制') : message.error('复制失败，请手动选择复制'),
                )
              }
            >
              复制
            </Button>
          </Space.Compact>
        </li>
        <li>生成完回到本页刷新，逐条审核后点「审核通过」。</li>
      </ol>
    </Modal>
  );
}

/** 用勾选的用例开始一次执行，记下环境与包版本 / 分支 */
function CreateRunModal({
  projectKey,
  caseIds,
  open,
  onClose,
  onCreated,
}: {
  projectKey: string;
  caseIds: string[];
  open: boolean;
  onClose: () => void;
  onCreated: (run: TestRunItem) => void;
}) {
  const [form] = Form.useForm<{ name: string; env: string; build: string }>();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const submit = async (v: { name: string; env: string; build: string }) => {
    setSaving(true);
    try {
      const run = await api<TestRunItem>(`/projects/${projectKey}/tests/runs`, {
        method: 'POST',
        body: { ...v, caseIds },
      });
      message.success(`已创建 ${run.code}`);
      void qc.invalidateQueries({ queryKey: qk.tests(projectKey) });
      form.resetFields();
      onClose();
      onCreated(run);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`执行 ${caseIds.length} 条用例`}
      open={open}
      okText="开始执行"
      confirmLoading={saving}
      onOk={() => form.submit()}
      onCancel={onClose}
    >
      <Form
        form={form}
        layout="vertical"
        requiredMark="optional"
        initialValues={{ name: `${new Date().toLocaleDateString('zh-CN')} 执行` }}
        onFinish={(v) => void submit(v)}
      >
        <Form.Item name="name" label="名称" rules={[{ required: true, whitespace: true }]}>
          <Input maxLength={100} />
        </Form.Item>
        <Form.Item name="env" label="执行环境">
          <Input placeholder="如：Unity 编辑器、华为 SEA-AL10 / Android 10" maxLength={100} />
        </Form.Item>
        <Form.Item
          name="build"
          label="包版本 / 分支"
          tooltip="同一条用例在不同包上结果可能不同，记下来便于对比"
        >
          <Input placeholder="如：BudBox 1.0.1（11-05）/ cn_1.0.2_mobai" maxLength={200} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
