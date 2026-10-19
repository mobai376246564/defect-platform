import { SEVERITY_OPTIONS } from '@defect/shared';
import {
  Alert,
  Card,
  Col,
  DatePicker,
  Empty,
  Result,
  Row,
  Segmented,
  Select,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tabs,
  Typography,
} from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useProject, useReport } from '../../api/hooks';
import type {
  AgeReport,
  ClaudeReport,
  DistributionReport,
  EfficiencyReport,
  EfficiencyRow,
  FeedbackReportData,
  ProjectDetail,
  QualityReport,
  TrendReport,
  VersionReport,
} from '../../api/types';
import { EChart } from '../../components/EChart';
import { SeverityTag, StatusTag } from '../../components/Tags';
import { UserNames, userName } from '../../components/UserNames';
import {
  DIMENSIONS,
  ageOption,
  barsOption,
  claudeOption,
  dimensionLabel,
  duration,
  feedbackOption,
  flowOption,
  openOption,
  pct,
  qualityOption,
  versionOption,
} from './charts';
import { REPORT_TABS, currentTab, reportQuery, type ReportTab } from './query';

type Query = Record<string, string>;

/** 统计报表（方案 6.9）：8 张固定报表，统一按时间段、模块、版本、严重程度筛选。 */
export function ReportsPage() {
  const { key = '' } = useParams();
  const project = useProject(key);
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => reportQuery(params), [params]);
  const tab = currentTab(params);

  if (project.isError) return <Result status="404" title="项目不存在或你不是项目成员" />;
  if (!project.data) return <Skeleton active />;
  const p = project.data;

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const range: [Dayjs, Dayjs] = [
    query.from ? dayjs(query.from) : dayjs().subtract(29, 'day'),
    query.to ? dayjs(query.to) : dayjs(),
  ];

  const body: Record<ReportTab, ReactNode> = {
    trend: <TrendTab project={p} query={query} />,
    distribution: <DistributionTab project={p} query={query} />,
    age: <AgeTab project={p} query={query} />,
    versions: <VersionsTab project={p} query={query} />,
    efficiency: <EfficiencyTab project={p} query={query} />,
    quality: <QualityTab project={p} query={query} />,
    feedback: <FeedbackTab project={p} query={query} />,
    claude: <ClaudeTab project={p} query={query} />,
  };

  return (
    <div>
      <Typography.Title level={4} style={{ margin: '0 0 12px' }}>
        {p.name} · 统计报表
      </Typography.Title>
      <Space wrap style={{ marginBottom: 4 }}>
        <DatePicker.RangePicker
          allowClear={false}
          value={range}
          disabledDate={(d) => d.isAfter(dayjs(), 'day')}
          presets={[
            { label: '最近 7 天', value: [dayjs().subtract(6, 'day'), dayjs()] },
            { label: '最近 30 天', value: [dayjs().subtract(29, 'day'), dayjs()] },
            { label: '最近 90 天', value: [dayjs().subtract(89, 'day'), dayjs()] },
            { label: '今年', value: [dayjs().startOf('year'), dayjs()] },
          ]}
          onChange={(v) =>
            update({ from: v?.[0]?.format('YYYY-MM-DD'), to: v?.[1]?.format('YYYY-MM-DD') })
          }
        />
        <Segmented
          value={query.granularity ?? 'day'}
          options={[
            { value: 'day', label: '按日' },
            { value: 'week', label: '按周' },
          ]}
          onChange={(v) => update({ granularity: v === 'day' ? undefined : String(v) })}
        />
        <Select
          allowClear
          placeholder="模块（含子模块）"
          style={{ minWidth: 150 }}
          value={query.moduleId}
          options={p.modules.map((m) => ({ value: m.id, label: m.name }))}
          onChange={(v?: string) => update({ moduleId: v })}
        />
        <Select
          allowClear
          placeholder="发现版本"
          style={{ minWidth: 130 }}
          value={query.versionId}
          options={p.versions.map((v) => ({ value: v.id, label: v.name }))}
          onChange={(v?: string) => update({ versionId: v })}
        />
        <Select
          allowClear
          placeholder="严重程度"
          style={{ minWidth: 120 }}
          value={query.severity}
          options={SEVERITY_OPTIONS}
          onChange={(v?: string) => update({ severity: v })}
        />
      </Space>
      <Tabs
        activeKey={tab}
        onChange={(t) => update({ tab: t === 'trend' ? undefined : t })}
        items={REPORT_TABS.map((t) => ({ key: t.key, label: t.label, children: body[t.key] }))}
        destroyOnHidden
      />
    </div>
  );
}

interface TabProps {
  project: ProjectDetail;
  query: Query;
}

/** 加载中显示骨架，出错显示原因，拿到数据后渲染内容。 */
function Loaded<T>({
  state,
  children,
}: {
  state: { data?: T; error: Error | null; isError: boolean };
  children: (data: T) => ReactNode;
}) {
  if (state.isError) return <Alert type="error" showIcon message={state.error?.message} />;
  if (!state.data) return <Skeleton active paragraph={{ rows: 8 }} />;
  return <>{children(state.data)}</>;
}

function ChartCard({
  title,
  extra,
  children,
}: {
  title: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card size="small" title={title} extra={extra} style={{ marginBottom: 16 }}>
      {children}
    </Card>
  );
}

function Stat({ title, value, hint }: { title: string; value: ReactNode; hint?: string }) {
  return (
    <Card size="small">
      <Statistic title={title} value={value as string} />
      {hint && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {hint}
        </Typography.Text>
      )}
    </Card>
  );
}

function TrendTab({ project, query }: TabProps) {
  const r = useReport<TrendReport>(project.key, 'trend', query);
  return (
    <Loaded state={r}>
      {(d) => (
        <>
          <ChartCard title="新增 / 解决 / 关闭">
            <EChart option={flowOption(d)} />
          </ChartCard>
          <ChartCard
            title="未关闭存量"
            extra={
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {d.snapshotDays > 0
                  ? `其中 ${d.snapshotDays} 天取自每日快照，其余按缺陷时间戳还原`
                  : '按缺陷时间戳还原（按模块 / 版本筛选或尚无快照时）'}
              </Typography.Text>
            }
          >
            <EChart option={openOption(d)} height={240} />
          </ChartCard>
        </>
      )}
    </Loaded>
  );
}

function DistributionTab({ project, query }: TabProps) {
  const [scope, setScope] = useState<'open' | 'created'>('open');
  const r = useReport<DistributionReport>(project.key, 'distribution', { ...query, scope });
  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Segmented
          value={scope}
          options={[
            { value: 'open', label: '当前未关闭' },
            { value: 'created', label: '时间段内新建' },
          ]}
          onChange={(v) => setScope(v as 'open' | 'created')}
        />
        {r.data && <Typography.Text type="secondary">共 {r.data.total} 个缺陷</Typography.Text>}
      </Space>
      <Loaded state={r}>
        {(d) =>
          d.total === 0 ? (
            <Empty description="没有符合条件的缺陷" />
          ) : (
            <Row gutter={16}>
              {DIMENSIONS.map((dim) => {
                const items = d[dim.key].map((i) => ({
                  name: dimensionLabel(dim.key, i.key, project),
                  count: i.count,
                }));
                return (
                  <Col xs={24} xl={12} key={dim.key}>
                    <ChartCard title={`按${dim.label}`}>
                      <EChart
                        option={barsOption(items)}
                        height={Math.max(160, 40 + items.length * 28)}
                      />
                    </ChartCard>
                  </Col>
                );
              })}
            </Row>
          )
        }
      </Loaded>
    </>
  );
}

function AgeTab({ project, query }: TabProps) {
  const r = useReport<AgeReport>(project.key, 'age', query);
  return (
    <Loaded state={r}>
      {(d) => (
        <>
          <ChartCard title={`未关闭缺陷的存活天数（共 ${d.total} 个）`}>
            <EChart option={ageOption(d)} />
          </ChartCard>
          <ChartCard title="存活最久的 10 个缺陷">
            <Table
              size="small"
              rowKey="code"
              pagination={false}
              dataSource={d.oldest}
              columns={[
                {
                  title: '编号',
                  dataIndex: 'code',
                  width: 110,
                  render: (c: string) => <Link to={`/p/${project.key}/bugs/${c}`}>{c}</Link>,
                },
                { title: '标题', dataIndex: 'title', ellipsis: true },
                {
                  title: '状态',
                  dataIndex: 'status',
                  width: 110,
                  render: (s: string) => <StatusTag value={s} workflow={project.workflow} />,
                },
                {
                  title: '严重程度',
                  dataIndex: 'severity',
                  width: 96,
                  render: (s: string) => <SeverityTag value={s} />,
                },
                {
                  title: '处理人',
                  dataIndex: 'ownerIds',
                  width: 140,
                  render: (ids: string[]) => <UserNames members={project.members} ids={ids} />,
                },
                {
                  title: '已存活',
                  dataIndex: 'ageDays',
                  width: 90,
                  render: (n: number) => `${n} 天`,
                },
              ]}
            />
          </ChartCard>
        </>
      )}
    </Loaded>
  );
}

function VersionsTab({ project, query }: TabProps) {
  const r = useReport<VersionReport>(project.key, 'versions', query);
  return (
    <Loaded state={r}>
      {(d) =>
        d.rows.length === 0 ? (
          <Empty description="项目还没有版本，可在项目设置中添加" />
        ) : (
          <>
            <ChartCard title="各发现版本的缺陷数与严重程度构成">
              <EChart option={versionOption(d)} />
            </ChartCard>
            <ChartCard title="版本明细">
              <Table
                size="small"
                rowKey={(v) => v.versionId ?? 'none'}
                pagination={false}
                dataSource={d.rows}
                columns={[
                  { title: '版本', dataIndex: 'name' },
                  {
                    title: '发布时间',
                    dataIndex: 'releasedAt',
                    render: (v: string | null) => (v ? dayjs(v).format('YYYY-MM-DD') : '—'),
                  },
                  { title: '缺陷数', dataIndex: 'total', align: 'right' },
                  { title: '当前未关闭', dataIndex: 'open', align: 'right' },
                  {
                    title: '发版时未关闭',
                    dataIndex: 'openAtRelease',
                    align: 'right',
                    render: (v: number | null) => v ?? '—',
                  },
                ]}
              />
            </ChartCard>
          </>
        )
      }
    </Loaded>
  );
}

function EfficiencyTab({ project, query }: TabProps) {
  const [by, setBy] = useState<'byPerson' | 'byModule'>('byPerson');
  const r = useReport<EfficiencyReport>(project.key, 'efficiency', query);
  const nameOf = (key: string) =>
    by === 'byPerson'
      ? key
        ? userName(project.members, key)
        : '未指派'
      : dimensionLabel('module', key, project);
  return (
    <>
      <Space style={{ marginBottom: 12 }} wrap>
        <Segmented
          value={by}
          options={[
            { value: 'byPerson', label: '按人' },
            { value: 'byModule', label: '按模块' },
          ]}
          onChange={(v) => setBy(v as 'byPerson' | 'byModule')}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          响应 = 确认 → 开始处理，解决 = 确认 → 首次解决，按工作日计时；SLA 达成率 = 时限内解决 ÷
          设了 SLA 且已解决
        </Typography.Text>
      </Space>
      <Loaded state={r}>
        {(d) => {
          const data = d[by];
          return (
            <Table<EfficiencyRow>
              size="small"
              rowKey="key"
              pagination={false}
              dataSource={data.rows}
              columns={[
                { title: by === 'byPerson' ? '处理人' : '模块', dataIndex: 'key', render: nameOf },
                {
                  title: '平均响应',
                  dataIndex: 'avgResponseHours',
                  align: 'right',
                  sorter: (a, b) => (a.avgResponseHours ?? -1) - (b.avgResponseHours ?? -1),
                  render: (v: number | null, row) => `${duration(v)}（${row.responseCount}）`,
                },
                {
                  title: '平均解决',
                  dataIndex: 'avgResolveHours',
                  align: 'right',
                  sorter: (a, b) => (a.avgResolveHours ?? -1) - (b.avgResolveHours ?? -1),
                  render: (v: number | null, row) => `${duration(v)}（${row.resolveCount}）`,
                },
                {
                  title: 'SLA 达成率',
                  dataIndex: 'slaRate',
                  align: 'right',
                  sorter: (a, b) => (a.slaRate ?? -1) - (b.slaRate ?? -1),
                  render: (v: number | null, row) =>
                    row.slaTotal ? `${pct(v)}（${row.slaMet}/${row.slaTotal}）` : '—',
                },
                {
                  title: '在手',
                  dataIndex: 'inHand',
                  align: 'right',
                  sorter: (a, b) => a.inHand - b.inHand,
                },
              ]}
              summary={() => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0}>
                    <Typography.Text strong>合计</Typography.Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    {duration(data.total.avgResponseHours)}（{data.total.responseCount}）
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right">
                    {duration(data.total.avgResolveHours)}（{data.total.resolveCount}）
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="right">
                    {data.total.slaTotal
                      ? `${pct(data.total.slaRate)}（${data.total.slaMet}/${data.total.slaTotal}）`
                      : '—'}
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="right">
                    {data.total.inHand}
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              )}
            />
          );
        }}
      </Loaded>
    </>
  );
}

function QualityTab({ project, query }: TabProps) {
  const r = useReport<QualityReport>(project.key, 'quality', query);
  return (
    <Loaded state={r}>
      {(d) => (
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={12} md={6}>
              <Stat title="解决的缺陷" value={d.summary.resolved} hint="时间段内首次解决" />
            </Col>
            <Col xs={12} md={6}>
              <Stat title="被重新打开" value={d.summary.reopened} />
            </Col>
            <Col xs={12} md={6}>
              <Stat title="重开率" value={pct(d.summary.reopenRate)} />
            </Col>
            <Col xs={12} md={6}>
              <Stat title="一次修复率" value={pct(d.summary.firstPassRate)} />
            </Col>
          </Row>
          <ChartCard title="重开率趋势（按解决时间）">
            <EChart option={qualityOption(d)} />
          </ChartCard>
        </>
      )}
    </Loaded>
  );
}

function FeedbackTab({ project, query }: TabProps) {
  const r = useReport<FeedbackReportData>(project.key, 'feedback', query);
  return (
    <Loaded state={r}>
      {(d) => (
        <>
          {project.appIds.length === 0 && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="项目还没有绑定 APP 包名，APP 反馈不会统计到这里"
            />
          )}
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={12} md={6}>
              <Stat title="APP 反馈" value={d.summary.total} />
            </Col>
            <Col xs={12} md={6}>
              <Stat title="新建缺陷" value={d.summary.created} />
            </Col>
            <Col xs={12} md={6}>
              <Stat title="合并到已有缺陷" value={d.summary.merged} />
            </Col>
            <Col xs={12} md={6}>
              <Stat title="建单率" value={pct(d.summary.createRate)} hint="新建缺陷 ÷ 全部反馈" />
            </Col>
          </Row>
          <ChartCard title="反馈量与处理结果">
            <EChart option={feedbackOption(d)} />
          </ChartCard>
          <ChartCard title="重复反馈最多的缺陷">
            <Table
              size="small"
              rowKey="code"
              pagination={false}
              dataSource={d.top}
              columns={[
                {
                  title: '编号',
                  dataIndex: 'code',
                  width: 110,
                  render: (c: string) => <Link to={`/p/${project.key}/bugs/${c}`}>{c}</Link>,
                },
                { title: '标题', dataIndex: 'title', ellipsis: true },
                {
                  title: '状态',
                  dataIndex: 'status',
                  width: 110,
                  render: (s: string) => <StatusTag value={s} workflow={project.workflow} />,
                },
                {
                  title: '严重程度',
                  dataIndex: 'severity',
                  width: 96,
                  render: (s: string) => <SeverityTag value={s} />,
                },
                { title: '反馈次数', dataIndex: 'feedbackCount', width: 90, align: 'right' },
              ]}
            />
          </ChartCard>
        </>
      )}
    </Loaded>
  );
}

function ClaudeTab({ project, query }: TabProps) {
  const r = useReport<ClaudeReport>(project.key, 'claude', query);
  return (
    <Loaded state={r}>
      {(d) => (
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={12} md={6}>
              <Stat
                title="Claude 参与比例"
                value={pct(d.summary.ratio)}
                hint={`${d.summary.withClaude} / ${d.summary.resolved} 个解决的缺陷`}
              />
            </Col>
            <Col xs={12} md={6}>
              <Stat title="MCP 调用次数" value={d.summary.mcpCalls} />
            </Col>
            <Col xs={12} md={6}>
              <Stat title="Claude 回写评论" value={d.summary.claudeComments} />
            </Col>
            <Col xs={12} md={6}>
              <Stat
                title="平均解决时长"
                value={duration(d.compare.withClaude.avgResolveHours)}
                hint={`未参与：${duration(d.compare.withoutClaude.avgResolveHours)}`}
              />
            </Col>
          </Row>
          <ChartCard title="参与与未参与对比">
            <Table
              size="small"
              rowKey="group"
              pagination={false}
              dataSource={[
                { group: 'Claude 参与', ...d.compare.withClaude },
                { group: '未参与', ...d.compare.withoutClaude },
              ]}
              columns={[
                { title: '', dataIndex: 'group' },
                { title: '解决数', dataIndex: 'count', align: 'right' },
                {
                  title: '平均解决时长',
                  dataIndex: 'avgResolveHours',
                  align: 'right',
                  render: (v: number | null) => duration(v),
                },
                {
                  title: '重开率',
                  dataIndex: 'reopenRate',
                  align: 'right',
                  render: (v: number | null) => pct(v),
                },
              ]}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Claude 参与 = 解决前有过 MCP 读取记录或 Claude 回写评论的缺陷
            </Typography.Text>
          </ChartCard>
          <ChartCard title="解决的缺陷中 Claude 参与情况">
            <EChart option={claudeOption(d)} />
          </ChartCard>
        </>
      )}
    </Loaded>
  );
}
