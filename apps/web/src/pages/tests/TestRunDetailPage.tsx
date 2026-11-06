import { ArrowLeftOutlined, BugOutlined, ReloadOutlined, RobotOutlined } from '@ant-design/icons';
import {
  hasPermission,
  TEST_CASE_MODE,
  TEST_RESULT_STATUS_OPTIONS,
  TEST_RUN_STATUS,
} from '@defect/shared';
import { useQueryClient } from '@tanstack/react-query';
import { App, Button, Segmented, Select, Space, Spin, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { qk, useProject, useTestRun } from '../../api/hooks';
import type { TestResultItem, TestResultStatusKey } from '../../api/types';
import { DefectDrawer, useDefectDrawer } from '../../components/DefectDrawer';
import { DefectCreateModal } from '../defects/DefectCreateModal';
import { CaseBrief } from './TestCasesPage';
import { RESULT_TAGS } from './TestRunsPage';

/** 把一条失败的用例整理成缺陷的预填内容 */
function defectDraft(r: TestResultItem) {
  const c = r.testCase;
  const steps = [
    ...(c.precondition ? [`前置条件：${c.precondition}`] : []),
    ...c.steps.map((s, i) => `${i + 1}. ${s}`),
    ...(c.testData ? [`测试数据：${c.testData}`] : []),
  ].join('\n');
  return {
    title: `[${c.code}] ${c.title}`,
    steps,
    expected: c.expected.join('\n'),
    actual: r.note,
  };
}

/**
 * 一次执行的详情：逐条录入结果和说明；失败的用例一键建单，建好后自动关联回结果。
 */
export function TestRunDetailPage() {
  const { key = '', id = '' } = useParams();
  const project = useProject(key);
  const run = useTestRun(key, id);
  const canManage = hasPermission(project.data?.myRole, 'test.manage');
  const qc = useQueryClient();
  const { message } = App.useApp();
  const drawer = useDefectDrawer();
  const [filter, setFilter] = useState<TestResultStatusKey | 'all'>('all');
  const [filing, setFiling] = useState<TestResultItem | null>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: qk.tests(key) });

  /** 回写一条结果（状态 / 说明 / 关联缺陷） */
  const patch = async (
    r: TestResultItem,
    body: { status?: string; note?: string; defectCode?: string },
  ) => {
    try {
      await api(`/projects/${key}/tests/runs/${id}/results/${r.caseId}`, {
        method: 'PATCH',
        body,
      });
      refresh();
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const setRunStatus = async (status: 'running' | 'done') => {
    try {
      await api(`/projects/${key}/tests/runs/${id}`, { method: 'PATCH', body: { status } });
      refresh();
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const results = run.data?.results;
  const stats = useMemo(() => {
    const s: Partial<Record<TestResultStatusKey, number>> = {};
    for (const r of results ?? []) s[r.status] = (s[r.status] ?? 0) + 1;
    return s;
  }, [results]);
  const shown = filter === 'all' ? results : results?.filter((r) => r.status === filter);
  // 用 useMemo 保持引用不变，避免预填值在每次渲染时重新写入建单表单
  const draft = useMemo(() => (filing ? defectDraft(filing) : undefined), [filing]);

  const columns: ColumnsType<TestResultItem> = [
    {
      title: '编号',
      dataIndex: ['testCase', 'code'],
      width: 80,
      render: (v: string) => <span className="mono">{v}</span>,
    },
    { title: '模块', dataIndex: ['testCase', 'module'], width: 140, ellipsis: true },
    { title: '标题', dataIndex: ['testCase', 'title'], ellipsis: true },
    {
      title: '方式',
      dataIndex: ['testCase', 'mode'],
      width: 70,
      render: (v: 'auto' | 'manual', r) => (
        <Tooltip title={v === 'manual' ? r.testCase.manualReason : undefined}>
          <Tag bordered={false} color={v === 'manual' ? 'purple' : 'blue'}>
            {TEST_CASE_MODE[v]}
          </Tag>
        </Tooltip>
      ),
    },
    {
      title: '结果',
      dataIndex: 'status',
      width: 110,
      render: (v: TestResultStatusKey, r) =>
        canManage ? (
          <Select
            size="small"
            value={v}
            style={{ width: 92 }}
            options={TEST_RESULT_STATUS_OPTIONS}
            onChange={(status) => void patch(r, { status })}
          />
        ) : (
          <Tag color={RESULT_TAGS.find((t) => t.key === v)?.color}>
            {RESULT_TAGS.find((t) => t.key === v)?.label}
          </Tag>
        ),
    },
    {
      title: '说明',
      dataIndex: 'note',
      render: (v: string, r) => (
        <Typography.Paragraph
          style={{ margin: 0 }}
          ellipsis={{ rows: 2, expandable: 'collapsible' }}
          editable={
            canManage
              ? {
                  text: v,
                  tooltip: '编辑说明',
                  autoSize: { minRows: 2, maxRows: 8 },
                  onChange: (note) => note !== v && void patch(r, { note }),
                }
              : false
          }
        >
          {v || <Typography.Text type="secondary">—</Typography.Text>}
        </Typography.Paragraph>
      ),
    },
    {
      title: '缺陷',
      dataIndex: 'defectCode',
      width: 120,
      render: (v: string | null, r) =>
        v ? (
          <Typography.Link className="mono" data-open-defect onClick={() => drawer.open(v)}>
            {v}
          </Typography.Link>
        ) : (
          canManage &&
          (r.status === 'failed' || r.status === 'doubtful') && (
            <Button size="small" icon={<BugOutlined />} onClick={() => setFiling(r)}>
              建单
            </Button>
          )
        ),
    },
    {
      title: '执行',
      dataIndex: 'executedAt',
      width: 130,
      render: (v: string | null, r) =>
        v && (
          <Space size={4}>
            {r.executor === 'ai' && <RobotOutlined />}
            <span>{r.executedByName}</span>
            <span className="mono" style={{ color: 'var(--ant-color-text-tertiary)' }}>
              {dayjs(v).format('HH:mm')}
            </span>
          </Space>
        ),
    },
  ];

  if (!run.data) {
    return run.isError ? (
      <Typography.Text type="danger">{(run.error as Error).message}</Typography.Text>
    ) : (
      <Spin style={{ display: 'block', margin: '96px auto' }} />
    );
  }
  const r = run.data;

  return (
    <div className="page">
      <div className="page-header">
        <Link to={`/p/${key}/tests/runs`} aria-label="返回执行记录">
          <ArrowLeftOutlined />
        </Link>
        <Typography.Title level={4}>
          <span className="mono">{r.code}</span> {r.name}
        </Typography.Title>
        <Tag color={r.status === 'running' ? 'processing' : 'default'}>
          {TEST_RUN_STATUS[r.status]}
        </Tag>
        <div style={{ flex: 1 }} />
        <Tooltip title="刷新">
          <Button icon={<ReloadOutlined />} aria-label="刷新" onClick={refresh} />
        </Tooltip>
        {canManage &&
          (r.status === 'running' ? (
            <Button onClick={() => void setRunStatus('done')}>结束执行</Button>
          ) : (
            <Button onClick={() => void setRunStatus('running')}>重新打开</Button>
          ))}
      </div>

      <Space wrap size={[16, 4]} style={{ marginBottom: 12 }}>
        <Typography.Text type="secondary">环境：{r.env || '—'}</Typography.Text>
        <Typography.Text type="secondary">包版本 / 分支：{r.build || '—'}</Typography.Text>
        <Typography.Text type="secondary">
          {r.createdByName ?? '—'} 发起于 {dayjs(r.createdAt).format('YYYY-MM-DD HH:mm')}
        </Typography.Text>
      </Space>

      <div style={{ marginBottom: 12 }}>
        <Segmented
          value={filter}
          onChange={(v) => setFilter(v as TestResultStatusKey | 'all')}
          options={[
            { value: 'all', label: `全部 ${results?.length ?? 0}` },
            ...RESULT_TAGS.filter((t) => stats[t.key]).map((t) => ({
              value: t.key,
              label: `${t.label} ${stats[t.key]}`,
            })),
          ]}
        />
      </div>

      <Table<TestResultItem>
        rowKey="id"
        size="middle"
        columns={columns}
        dataSource={shown}
        pagination={false}
        expandable={{ expandedRowRender: (row) => <CaseBrief value={row.testCase} /> }}
      />

      <DefectCreateModal
        projectKey={key}
        project={project.data}
        open={!!filing}
        initialValues={draft}
        onClose={() => setFiling(null)}
        onCreated={(created) => {
          if (filing) void patch(filing, { defectCode: created.code });
        }}
      />
      <DefectDrawer code={drawer.code} onClose={drawer.close} />
    </div>
  );
}
