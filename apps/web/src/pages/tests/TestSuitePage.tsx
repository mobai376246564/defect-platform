import {
  ArrowLeftOutlined,
  BugOutlined,
  DownloadOutlined,
  HistoryOutlined,
  ReloadOutlined,
  RobotOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import {
  hasPermission,
  sheetStats,
  summarizeTestPoints,
  TEST_CASE_COLUMNS,
  TEST_CASE_MODE,
  TEST_CASE_MODE_OPTIONS,
  TEST_CASE_TYPES,
  TEST_PRIORITIES,
  TEST_RESULT,
  TEST_RESULT_OPTIONS,
  TEST_SUITE_FIXED_SHEETS,
  type TestCaseColumnKey,
} from '@defect/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Drawer,
  Input,
  List,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { qk, useProject, useTestSuite } from '../../api/hooks';
import type {
  TestCaseRow,
  TestQuestionItem,
  TestResultKey,
  TestRoundDetail,
  TestSuiteDetail,
} from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { DefectDrawer, useDefectDrawer } from '../../components/DefectDrawer';
import { DefectCreateModal } from '../defects/DefectCreateModal';
import { downloadSuiteExcel, RESULT_COLOR, ResultStats } from './common';

/** Excel 列宽（字符数）换算成像素 */
const px = (excelWidth: number) => Math.round(excelWidth * 8);

/** 表格区域高度：留出页头、工具栏和底部工作表页签 */
const SHEET_HEIGHT = 'calc(100vh - 290px)';

/**
 * 可编辑单元格：平时显示文字，点一下变成输入框（或下拉框），失焦 / Ctrl+Enter 保存，Esc 取消。
 */
function EditableCell({
  value,
  canEdit,
  options,
  render,
  onSave,
}: {
  value: string;
  canEdit: boolean;
  /** 有选项时用下拉框编辑 */
  options?: { value: string; label: string }[];
  /** 非编辑状态下的展示 */
  render?: (v: string) => ReactNode;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const shown = render ? render(value) : value;

  if (!canEdit) return <div className="suite-cell-text">{shown}</div>;
  if (!editing) {
    return (
      <div
        className="suite-cell"
        role="button"
        tabIndex={0}
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setDraft(value);
            setEditing(true);
          }
        }}
      >
        {shown || ' '}
      </div>
    );
  }
  if (options) {
    return (
      <Select
        size="small"
        autoFocus
        defaultOpen
        value={value}
        options={options}
        style={{ width: '100%', minWidth: 72 }}
        // 列很窄时下拉选项也要显示全
        popupMatchSelectWidth={false}
        onChange={(v) => {
          setEditing(false);
          if (v !== value) onSave(v);
        }}
        onBlur={() => setEditing(false)}
      />
    );
  }
  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };
  return (
    <Input.TextArea
      autoFocus
      autoSize={{ minRows: 1, maxRows: 12 }}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setEditing(false);
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit();
      }}
    />
  );
}

/** 把一条失败的用例整理成缺陷的预填内容 */
function defectDraft(c: TestCaseRow) {
  return {
    title: `[${c.code}] ${c.title}`,
    steps: [c.precondition && `前置条件：${c.precondition}`, c.steps].filter(Boolean).join('\n'),
    expected: c.expected,
    actual: c.actualResult,
  };
}

/**
 * 改完结果后的执行人：执行时间没变就沿用原来的；改成已执行是当前用户；改回未执行则清空。
 */
function executorName(before: TestCaseRow, saved: TestCaseRow, me: string | null): string | null {
  if (saved.executedAt === before.executedAt) return before.executedByName;
  if (!saved.executedAt) return null;
  return me;
}

const LIST = (values: readonly string[]) => values.map((v) => ({ value: v, label: v }));

/**
 * 用例文件：按 Excel 的样子展示，底部是工作表页签（概览 / 测试点汇总 / 需求待确认 / 各模块）。
 * 测试结果、实际结果等直接在表格里填写；失败的用例可一键建单并自动关联。
 */
export function TestSuitePage() {
  const { key = '', id = '' } = useParams();
  const project = useProject(key);
  const suite = useTestSuite(key, id);
  const { user } = useAuth();
  const canManage = hasPermission(project.data?.myRole, 'test.manage');
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const drawer = useDefectDrawer();
  const [sheet, setSheet] = useState<string>(TEST_SUITE_FIXED_SHEETS.overview);
  const [filing, setFiling] = useState<TestCaseRow | null>(null);
  const [roundsOpen, setRoundsOpen] = useState(false);

  const cacheKey = [...qk.tests(key), 'suite', id];
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.tests(key) });

  /** 改一条用例：成功后直接更新缓存里的这一行，不重新拉整份文件 */
  const patchCase = async (c: TestCaseRow, body: Partial<Record<string, string>>) => {
    try {
      const saved = await api<TestCaseRow>(`/projects/${key}/tests/suites/${id}/cases/${c.id}`, {
        method: 'PATCH',
        body,
      });
      qc.setQueryData<TestSuiteDetail>(cacheKey, (old) =>
        old
          ? {
              ...old,
              cases: old.cases.map((x) =>
                x.id === c.id
                  ? {
                      ...x,
                      ...saved,
                      executedByName: executorName(x, saved, user?.name ?? null),
                    }
                  : x,
              ),
            }
          : old,
      );
      void qc.invalidateQueries({ queryKey: [...qk.tests(key), 'suites'] });
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const patchQuestion = async (q: TestQuestionItem, body: Partial<TestQuestionItem>) => {
    try {
      await api(`/projects/${key}/tests/suites/${id}/questions/${q.id}`, { method: 'PATCH', body });
      qc.setQueryData<TestSuiteDetail>(cacheKey, (old) =>
        old
          ? {
              ...old,
              questions: old.questions.map((x) => (x.id === q.id ? { ...x, ...body } : x)),
            }
          : old,
      );
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const newRound = () =>
    modal.confirm({
      title: `结束第 ${suite.data?.round} 轮，开始新一轮？`,
      content: '本轮每条用例的测试结果、实际结果和关联缺陷会存进「历史轮次」，然后清空，备注保留。',
      okText: '开始新一轮',
      onOk: async () => {
        try {
          const res = await api<{ round: number }>(`/projects/${key}/tests/suites/${id}/rounds`, {
            method: 'POST',
          });
          message.success(`已开始第 ${res.round} 轮`);
          refresh();
        } catch (err) {
          message.error((err as Error).message);
        }
      },
    });

  const draft = useMemo(() => (filing ? defectDraft(filing) : undefined), [filing]);

  if (!suite.data) {
    return suite.isError ? (
      <Typography.Text type="danger">{(suite.error as Error).message}</Typography.Text>
    ) : (
      <Spin style={{ display: 'block', margin: '96px auto' }} />
    );
  }
  const s = suite.data;
  const sheetNames = s.sheets.map((x) => x.name);
  const casesOf = (name: string) => s.cases.filter((c) => c.sheet === name);
  const stats: Partial<Record<TestResultKey, number>> = {};
  for (const c of s.cases) stats[c.result] = (stats[c.result] ?? 0) + 1;

  const tabs = [
    {
      key: TEST_SUITE_FIXED_SHEETS.overview,
      label: TEST_SUITE_FIXED_SHEETS.overview,
      children: <OverviewSheet suite={s} onOpenSheet={setSheet} />,
    },
    {
      key: TEST_SUITE_FIXED_SHEETS.points,
      label: TEST_SUITE_FIXED_SHEETS.points,
      children: <PointsSheet suite={s} />,
    },
    {
      key: TEST_SUITE_FIXED_SHEETS.questions,
      label: `${TEST_SUITE_FIXED_SHEETS.questions} ${s.questions.length}`,
      children: (
        <QuestionsSheet suite={s} canEdit={canManage} onSave={(q, b) => void patchQuestion(q, b)} />
      ),
    },
    ...sheetNames.map((name) => ({
      key: name,
      label: `${name} ${casesOf(name).length}`,
      children: (
        <CaseSheet
          docName={s.docName}
          cases={casesOf(name)}
          canEdit={canManage}
          onSave={(c, b) => void patchCase(c, b)}
          onFile={setFiling}
          onOpenDefect={drawer.open}
        />
      ),
    })),
  ];

  return (
    <div className="page">
      <div className="page-header">
        <Link to={`/p/${key}/tests`} aria-label="返回用例库">
          <ArrowLeftOutlined />
        </Link>
        <Typography.Title level={4}>{s.name}</Typography.Title>
        <Tag bordered={false} color="blue">
          第 {s.round} 轮
        </Tag>
        <ResultStats stats={stats} />
        <div style={{ flex: 1 }} />
        <Tooltip title="刷新">
          <Button icon={<ReloadOutlined />} aria-label="刷新" onClick={refresh} />
        </Tooltip>
        <Button icon={<HistoryOutlined />} onClick={() => setRoundsOpen(true)}>
          历史轮次 {s.rounds.length || ''}
        </Button>
        {canManage && (
          <Button icon={<SyncOutlined />} onClick={newRound}>
            开始新一轮
          </Button>
        )}
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          onClick={() =>
            void downloadSuiteExcel(key, id, s.name).catch((err: Error) =>
              message.error(err.message),
            )
          }
        >
          下载 Excel
        </Button>
      </div>

      <Tabs
        className="suite-tabs"
        type="card"
        size="small"
        tabPosition="bottom"
        activeKey={sheet}
        onChange={setSheet}
        items={tabs}
        destroyOnHidden
      />

      <DefectCreateModal
        projectKey={key}
        project={project.data}
        open={!!filing}
        initialValues={draft}
        onClose={() => setFiling(null)}
        onCreated={(created) => {
          if (filing) void patchCase(filing, { defectCode: created.code });
        }}
      />
      <DefectDrawer code={drawer.code} onClose={drawer.close} />
      <RoundsDrawer
        projectKey={key}
        suite={s}
        open={roundsOpen}
        onClose={() => setRoundsOpen(false)}
      />
    </div>
  );
}

/** 概览：需求来源、各模块用例数与优先级分布（与 Excel 一致），加上本轮测试进度 */
function OverviewSheet({
  suite,
  onOpenSheet,
}: {
  suite: TestSuiteDetail;
  onOpenSheet: (sheet: string) => void;
}) {
  const rows = sheetStats(
    suite.cases,
    suite.sheets.map((x) => x.name),
  ).map((st, i) => ({ ...st, module: suite.sheets[i]?.module ?? st.sheet }));
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((n, r) => n + f(r), 0);
  // 需求来源里可能是「文档名（版本）：链接」，把其中的链接单独做成可点的
  const url = /https?:\/\/\S+/.exec(suite.source)?.[0];
  const progress: TestResultKey[] = ['passed', 'failed', 'doubtful', 'blocked', 'pending'];

  return (
    <div className="suite-overview" style={{ height: SHEET_HEIGHT, overflow: 'auto' }}>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        {suite.name}
      </Typography.Title>
      <Typography.Text strong>需求来源</Typography.Text>
      <Typography.Paragraph style={{ marginTop: 4 }}>
        {url ? (
          <>
            {suite.source.slice(0, suite.source.indexOf(url))}
            <a href={url} target="_blank" rel="noreferrer">
              {url}
            </a>
            {suite.source.slice(suite.source.indexOf(url) + url.length)}
          </>
        ) : (
          suite.source || '—'
        )}
      </Typography.Paragraph>
      <Table
        className="suite-sheet"
        rowKey="sheet"
        size="small"
        bordered
        pagination={false}
        dataSource={rows}
        style={{ maxWidth: 1100 }}
        columns={[
          { title: '需求文档', key: 'doc', render: () => suite.docName, width: 180 },
          { title: '模块', dataIndex: 'module', width: 160 },
          {
            title: '工作表',
            dataIndex: 'sheet',
            width: 140,
            render: (v: string) => <a onClick={() => onOpenSheet(v)}>{v}</a>,
          },
          { title: '用例数', dataIndex: 'total', width: 70, align: 'right' },
          ...TEST_PRIORITIES.map((p) => ({
            title: p,
            key: p,
            width: 56,
            align: 'right' as const,
            render: (_: unknown, r: (typeof rows)[number]) => r.priority[p] ?? 0,
          })),
          {
            title: '本轮进度',
            key: 'progress',
            render: (_: unknown, r: (typeof rows)[number]) => <ResultStats stats={r.result} />,
          },
        ]}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={3}>
              <strong>合计</strong>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={3} align="right">
              {sum((r) => r.total)}
            </Table.Summary.Cell>
            {TEST_PRIORITIES.map((p, i) => (
              <Table.Summary.Cell key={p} index={4 + i} align="right">
                {sum((r) => r.priority[p] ?? 0)}
              </Table.Summary.Cell>
            ))}
            <Table.Summary.Cell index={8}>
              {progress.map((k) => {
                const n = sum((r) => r.result[k] ?? 0);
                return n ? (
                  <Tag key={k} bordered={false} color={RESULT_COLOR[k]}>
                    {TEST_RESULT[k]} {n}
                  </Tag>
                ) : null;
              })}
            </Table.Summary.Cell>
          </Table.Summary.Row>
        )}
      />
      {suite.notes.length > 0 && (
        <ul className="suite-notes">
          {suite.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 测试点汇总：由用例按「模块 + 子模块 + 测试点」汇总 */
function PointsSheet({ suite }: { suite: TestSuiteDetail }) {
  const rows = summarizeTestPoints(
    suite.cases,
    suite.sheets.map((x) => x.name),
  ).map((r, i) => ({ ...r, seq: i + 1 }));
  return (
    <Table
      className="suite-sheet"
      rowKey="seq"
      size="small"
      bordered
      pagination={false}
      dataSource={rows}
      scroll={{ x: 1100, y: SHEET_HEIGHT }}
      columns={[
        { title: '序号', dataIndex: 'seq', width: 60 },
        { title: '需求文档', key: 'doc', width: 150, render: () => suite.docName },
        { title: '模块', dataIndex: 'module', width: 140 },
        { title: '子模块', dataIndex: 'subModule', width: 140 },
        { title: '测试点', dataIndex: 'testPoint', width: 160 },
        {
          title: '关联用例数',
          key: 'count',
          width: 90,
          align: 'right',
          render: (_, r) => r.codes.length,
        },
        { title: '关联用例编号', key: 'codes', render: (_, r) => r.codes.join('、') },
      ]}
    />
  );
}

/** 需求待确认：产品在这里回填确认结果和确认人 */
function QuestionsSheet({
  suite,
  canEdit,
  onSave,
}: {
  suite: TestSuiteDetail;
  canEdit: boolean;
  onSave: (q: TestQuestionItem, body: Partial<TestQuestionItem>) => void;
}) {
  return (
    <Table<TestQuestionItem>
      className="suite-sheet"
      rowKey="id"
      size="small"
      bordered
      pagination={false}
      dataSource={suite.questions}
      scroll={{ x: 1100, y: SHEET_HEIGHT }}
      locale={{ emptyText: '没有待确认的问题' }}
      columns={[
        { title: '序号', dataIndex: 'seq', width: 60 },
        { title: '需求文档', key: 'doc', width: 150, render: () => suite.docName },
        { title: '模块', dataIndex: 'module', width: 110 },
        {
          title: '问题描述',
          dataIndex: 'question',
          render: (v: string) => <div className="suite-cell-text">{v}</div>,
        },
        {
          title: '确认结果',
          dataIndex: 'answer',
          width: 260,
          render: (v: string, q) => (
            <EditableCell value={v} canEdit={canEdit} onSave={(answer) => onSave(q, { answer })} />
          ),
        },
        {
          title: '确认人',
          dataIndex: 'confirmer',
          width: 100,
          render: (v: string, q) => (
            <EditableCell
              value={v}
              canEdit={canEdit}
              onSave={(confirmer) => onSave(q, { confirmer })}
            />
          ),
        },
      ]}
    />
  );
}

/** 列筛选：取这一列出现过的值 */
const filtersOf = (cases: TestCaseRow[], pick: (c: TestCaseRow) => string) =>
  [...new Set(cases.map(pick))].filter(Boolean).map((v) => ({ text: v, value: v }));

/** 模块工作表：列与团队 Excel 一致，最后一列是执行方式 */
function CaseSheet({
  docName,
  cases,
  canEdit,
  onSave,
  onFile,
  onOpenDefect,
}: {
  docName: string;
  cases: TestCaseRow[];
  canEdit: boolean;
  onSave: (c: TestCaseRow, body: Partial<Record<string, string>>) => void;
  onFile: (c: TestCaseRow) => void;
  onOpenDefect: (code: string) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const shown = keyword
    ? cases.filter((c) => c.code.includes(keyword) || c.title.includes(keyword))
    : cases;

  /** 每列的展示、编辑方式与筛选 */
  const cell = (k: TestCaseColumnKey): Partial<ColumnsType<TestCaseRow>[number]> => {
    const text = (field: keyof TestCaseRow) => ({
      render: (_: unknown, c: TestCaseRow) => (
        <EditableCell
          value={String(c[field] ?? '')}
          canEdit={canEdit}
          onSave={(v) => onSave(c, { [field]: v })}
        />
      ),
    });
    const filter = (pick: (c: TestCaseRow) => string) => ({
      filters: filtersOf(cases, pick),
      onFilter: (v: unknown, c: TestCaseRow) => pick(c) === v,
    });
    switch (k) {
      case 'code':
        return {
          fixed: 'left',
          render: (_, c) => <span className="mono">{c.code}</span>,
        };
      case 'docName':
        return { render: () => <span className="suite-cell-text">{docName}</span> };
      case 'subModule':
        return { ...text('subModule'), ...filter((c) => c.subModule) };
      case 'testPoint':
        return { ...text('testPoint'), ...filter((c) => c.testPoint) };
      case 'priority':
        return {
          align: 'center',
          ...filter((c) => c.priority),
          render: (_, c) => (
            <EditableCell
              value={c.priority}
              canEdit={canEdit}
              options={LIST(TEST_PRIORITIES)}
              render={(v) => <span className={v === 'P0' ? 'suite-p0' : undefined}>{v}</span>}
              onSave={(priority) => onSave(c, { priority })}
            />
          ),
        };
      case 'caseType':
        return {
          ...filter((c) => c.caseType),
          render: (_, c) => (
            <EditableCell
              value={c.caseType}
              canEdit={canEdit}
              options={LIST(TEST_CASE_TYPES)}
              onSave={(caseType) => onSave(c, { caseType })}
            />
          ),
        };
      case 'result':
        return {
          filters: TEST_RESULT_OPTIONS.map((o) => ({ text: o.label, value: o.value })),
          onFilter: (v, c) => c.result === v,
          render: (_, c) => (
            <Tooltip
              title={
                c.executedAt &&
                `${c.executor === 'ai' ? 'Claude' : (c.executedByName ?? '')} · ${dayjs(c.executedAt).format('MM-DD HH:mm')}`
              }
            >
              <div>
                <EditableCell
                  value={c.result}
                  canEdit={canEdit}
                  options={TEST_RESULT_OPTIONS}
                  render={(v) => (
                    <Tag color={RESULT_COLOR[v as TestResultKey]} bordered={false}>
                      {c.executor === 'ai' && <RobotOutlined style={{ marginRight: 4 }} />}
                      {TEST_RESULT[v as TestResultKey]}
                    </Tag>
                  )}
                  onSave={(result) => onSave(c, { result })}
                />
              </div>
            </Tooltip>
          ),
        };
      case 'remark':
        return {
          render: (_, c) => (
            <>
              <EditableCell
                value={c.remark}
                canEdit={canEdit}
                onSave={(remark) => onSave(c, { remark })}
              />
              {c.defectCode ? (
                <Typography.Link
                  className="mono"
                  data-open-defect
                  onClick={() => onOpenDefect(c.defectCode!)}
                >
                  <BugOutlined /> {c.defectCode}
                </Typography.Link>
              ) : (
                canEdit &&
                (c.result === 'failed' || c.result === 'doubtful') && (
                  <Button size="small" icon={<BugOutlined />} onClick={() => onFile(c)}>
                    建单
                  </Button>
                )
              )}
            </>
          ),
        };
      case 'mode':
        return {
          ...filter((c) => TEST_CASE_MODE[c.mode]),
          render: (_, c) => (
            <EditableCell
              value={c.mode}
              canEdit={canEdit}
              options={TEST_CASE_MODE_OPTIONS}
              render={(v) => (
                <Tag bordered={false} color={v === 'manual' ? 'purple' : 'blue'}>
                  {TEST_CASE_MODE[v as 'auto' | 'manual']}
                </Tag>
              )}
              onSave={(mode) => onSave(c, { mode })}
            />
          ),
        };
      default:
        return text(k as keyof TestCaseRow);
    }
  };

  const columns: ColumnsType<TestCaseRow> = TEST_CASE_COLUMNS.map((col) => ({
    key: col.key,
    title: col.label,
    width: px(col.width),
    ...cell(col.key),
  })) as ColumnsType<TestCaseRow>;

  return (
    <>
      <Input.Search
        allowClear
        size="small"
        placeholder="用例编号 / 标题"
        style={{ width: 220, marginBottom: 8 }}
        onSearch={setKeyword}
      />
      <Table<TestCaseRow>
        className="suite-sheet"
        rowKey="id"
        size="small"
        bordered
        pagination={false}
        dataSource={shown}
        columns={columns}
        scroll={{ x: TEST_CASE_COLUMNS.reduce((n, c) => n + px(c.width), 0), y: SHEET_HEIGHT }}
      />
    </>
  );
}

/** 历史轮次：每轮结束时存档的结果，点开查看 */
function RoundsDrawer({
  projectKey,
  suite,
  open,
  onClose,
}: {
  projectKey: string;
  suite: TestSuiteDetail;
  open: boolean;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const [viewing, setViewing] = useState<TestRoundDetail | null>(null);

  const view = async (round: number) => {
    try {
      setViewing(
        await api<TestRoundDetail>(
          `/projects/${projectKey}/tests/suites/${suite.id}/rounds/${round}`,
        ),
      );
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  return (
    <Drawer title="历史轮次" open={open} onClose={onClose} width={480}>
      <List
        dataSource={suite.rounds}
        locale={{ emptyText: '还没有结束过的轮次' }}
        renderItem={(r) => (
          <List.Item
            actions={[
              <a key="view" onClick={() => void view(r.round)}>
                查看
              </a>,
            ]}
          >
            <List.Item.Meta
              title={`第 ${r.round} 轮`}
              description={
                <Space direction="vertical" size={4}>
                  <span>
                    {r.finishedByName ?? '—'} 结束于{' '}
                    {dayjs(r.finishedAt).format('YYYY-MM-DD HH:mm')}
                  </span>
                  <span>
                    <ResultStats stats={r.stats} />
                  </span>
                </Space>
              }
            />
          </List.Item>
        )}
      />
      <Modal
        title={viewing && `第 ${viewing.round} 轮的结果`}
        open={!!viewing}
        footer={null}
        width={1000}
        onCancel={() => setViewing(null)}
      >
        <Table
          rowKey="code"
          size="small"
          bordered
          dataSource={viewing?.results}
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
          scroll={{ y: 480 }}
          columns={[
            { title: '用例编号', dataIndex: 'code', width: 100 },
            { title: '工作表', dataIndex: 'sheet', width: 120 },
            { title: '用例标题', dataIndex: 'title', ellipsis: true },
            {
              title: '测试结果',
              dataIndex: 'result',
              width: 90,
              filters: TEST_RESULT_OPTIONS.map((o) => ({ text: o.label, value: o.value })),
              onFilter: (v, r) => r.result === v,
              render: (v: TestResultKey) => (
                <Tag bordered={false} color={RESULT_COLOR[v]}>
                  {TEST_RESULT[v]}
                </Tag>
              ),
            },
            { title: '实际结果', dataIndex: 'actualResult', width: 180, ellipsis: true },
            { title: '缺陷', dataIndex: 'defectCode', width: 100 },
          ]}
        />
      </Modal>
    </Drawer>
  );
}
