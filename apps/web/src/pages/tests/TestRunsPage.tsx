import { ReloadOutlined } from '@ant-design/icons';
import { TEST_RUN_STATUS } from '@defect/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { Link, useParams } from 'react-router-dom';
import { qk, useProject, useTestRuns } from '../../api/hooks';
import type { TestResultStatusKey, TestRunItem } from '../../api/types';
import { TestsNav } from './TestsNav';

/** 结果状态的展示顺序与颜色（列表进度、详情汇总共用） */
export const RESULT_TAGS: { key: TestResultStatusKey; label: string; color: string }[] = [
  { key: 'passed', label: '通过', color: 'green' },
  { key: 'failed', label: '失败', color: 'red' },
  { key: 'doubtful', label: '存疑', color: 'orange' },
  { key: 'blocked', label: '阻塞', color: 'magenta' },
  { key: 'skipped', label: '跳过', color: 'default' },
  { key: 'pending', label: '未执行', color: 'default' },
];

/** 各结果状态的条数，按固定顺序显示，0 条的不显示 */
export function ResultStats({ stats }: { stats: Partial<Record<TestResultStatusKey, number>> }) {
  return (
    <>
      {RESULT_TAGS.filter((t) => stats[t.key]).map((t) => (
        <Tag key={t.key} color={t.color} bordered={false}>
          {t.label} {stats[t.key]}
        </Tag>
      ))}
    </>
  );
}

/** 执行记录列表：每次执行的环境、包版本与进度 */
export function TestRunsPage() {
  const { key = '' } = useParams();
  const project = useProject(key);
  const runs = useTestRuns(key);
  const qc = useQueryClient();

  const columns: ColumnsType<TestRunItem> = [
    {
      title: '编号',
      dataIndex: 'code',
      width: 80,
      render: (v: string) => <span className="mono">{v}</span>,
    },
    {
      title: '名称',
      dataIndex: 'name',
      ellipsis: true,
      render: (v: string, r) => <Link to={`/p/${key}/tests/runs/${r.id}`}>{v}</Link>,
    },
    { title: '执行环境', dataIndex: 'env', width: 170, ellipsis: true },
    { title: '包版本 / 分支', dataIndex: 'build', width: 180, ellipsis: true },
    {
      title: '进度',
      dataIndex: 'stats',
      width: 220,
      render: (v: TestRunItem['stats']) => <ResultStats stats={v} />,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: TestRunItem['status']) => (
        <Tag color={v === 'running' ? 'processing' : 'default'}>{TEST_RUN_STATUS[v]}</Tag>
      ),
    },
    { title: '发起人', dataIndex: 'createdByName', width: 90 },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 110,
      render: (v: string) => <span className="mono">{dayjs(v).format('MM-DD HH:mm')}</span>,
    },
  ];

  return (
    <div className="page">
      <TestsNav projectKey={key} projectName={project.data?.name} active="runs">
        <Tooltip title="刷新">
          <Button
            icon={<ReloadOutlined />}
            aria-label="刷新"
            onClick={() => void qc.invalidateQueries({ queryKey: qk.tests(key) })}
          />
        </Tooltip>
      </TestsNav>
      <Typography.Paragraph type="secondary">
        在「用例库」勾选用例后点「执行所选」开始一次执行。
      </Typography.Paragraph>
      <Table<TestRunItem>
        rowKey="id"
        size="middle"
        loading={runs.isFetching}
        columns={columns}
        dataSource={runs.data}
        pagination={{ pageSize: 50, hideOnSinglePage: true }}
        // 列多：窄屏横向滚动，保证名称列不被挤没
        scroll={{ x: 1100 }}
      />
    </div>
  );
}
