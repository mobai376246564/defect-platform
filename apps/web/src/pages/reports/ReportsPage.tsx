import {
  CheckCircleOutlined,
  CopyOutlined,
  InfoCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import {
  RESOLUTION,
  SEVERITY,
  SEVERITY_OPTIONS,
  findState,
  reviewPeriod,
  type ReviewPeriodKind,
  type Severity,
} from '@defect/shared';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Progress,
  Result,
  Row,
  Segmented,
  Select,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tabs,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
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
  ProcessReport,
  ProjectDetail,
  QualityReport,
  ReviewDefect,
  ReviewReport,
  StageRow,
  TrendReport,
  VersionReport,
} from '../../api/types';
import { copyText } from '../../components/clipboard';
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
  stageOption,
  versionOption,
} from './charts';
import {
  DEFAULT_TAB,
  REPORT_TABS,
  currentTab,
  reportQuery,
  reviewQuery,
  type ReportTab,
} from './query';
import {
  REVIEW_KPIS,
  formatKpi,
  kpiDelta,
  overdueText,
  reviewInsights,
  reviewMarkdown,
  type KpiDef,
} from './review';

type Query = Record<string, string>;

const DATE_FORMAT = 'YYYY-MM-DD';

/** 统计报表（方案 6.9）：复盘概览 + 9 张固定报表，统一按时间段、模块、版本、严重程度筛选。 */
export function ReportsPage() {
  const { key = '' } = useParams();
  const project = useProject(key);
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => reportQuery(params), [params]);
  const today = dayjs().format(DATE_FORMAT);
  const review = useMemo(() => reviewQuery(params, today), [params, today]);
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

  const filters = [
    query.moduleId && `模块 ${dimensionLabel('module', query.moduleId, p)}`,
    query.versionId && `版本 ${p.versions.find((v) => v.id === query.versionId)?.name ?? ''}`,
    query.severity && `严重程度 ${SEVERITY[query.severity as Severity] ?? query.severity}`,
  ]
    .filter(Boolean)
    .join('，');

  const body: Record<ReportTab, ReactNode> = {
    review: <ReviewTab project={p} query={review.query} kind={review.kind} filters={filters} />,
    trend: <TrendTab project={p} query={query} />,
    distribution: <DistributionTab project={p} query={query} />,
    age: <AgeTab project={p} query={query} />,
    versions: <VersionsTab project={p} query={query} />,
    efficiency: <EfficiencyTab project={p} query={query} />,
    quality: <QualityTab project={p} query={query} />,
    process: <ProcessTab project={p} query={query} />,
    feedback: <FeedbackTab project={p} query={query} />,
    claude: <ClaudeTab project={p} query={query} />,
  };

  return (
    <div>
      <Typography.Title level={4} style={{ margin: '0 0 12px' }}>
        {p.name} · 统计报表
      </Typography.Title>
      <Space wrap style={{ marginBottom: 4 }}>
        {tab === 'review' ? (
          <ReviewPeriodPicker
            kind={review.kind}
            from={review.query.from!}
            today={today}
            onChange={(kind, period) =>
              update({ period: kind === 'week' ? undefined : kind, ...period })
            }
          />
        ) : (
          <>
            <DatePicker.RangePicker
              allowClear={false}
              value={range}
              disabledDate={(d) => d.isAfter(dayjs(), 'day')}
              presets={rangePresets(today)}
              onChange={(v) =>
                update({ from: v?.[0]?.format(DATE_FORMAT), to: v?.[1]?.format(DATE_FORMAT) })
              }
            />
            <Segmented
              value={query.granularity ?? 'day'}
              options={[
                { value: 'day', label: '按日' },
                { value: 'week', label: '按周' },
                { value: 'month', label: '按月' },
              ]}
              onChange={(v) => update({ granularity: v === 'day' ? undefined : String(v) })}
            />
          </>
        )}
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
        onChange={(t) => update({ tab: t === DEFAULT_TAB ? undefined : t })}
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

/** 时间段快捷选项：自然周 / 月（复盘用）与滚动天数 */
function rangePresets(today: string): { label: string; value: [Dayjs, Dayjs] }[] {
  const span = (p: { from: string; to: string }): [Dayjs, Dayjs] => [dayjs(p.from), dayjs(p.to)];
  const ago = (n: number, unit: 'day' | 'month') =>
    dayjs(today).subtract(n, unit).format(DATE_FORMAT);
  return [
    { label: '本周', value: span(reviewPeriod('week', today, today)) },
    { label: '上周', value: span(reviewPeriod('week', ago(7, 'day'), today)) },
    { label: '本月', value: span(reviewPeriod('month', today, today)) },
    { label: '上月', value: span(reviewPeriod('month', ago(1, 'month'), today)) },
    { label: '最近 7 天', value: [dayjs().subtract(6, 'day'), dayjs()] },
    { label: '最近 30 天', value: [dayjs().subtract(29, 'day'), dayjs()] },
    { label: '最近 90 天', value: [dayjs().subtract(89, 'day'), dayjs()] },
    { label: '今年', value: [dayjs().startOf('year'), dayjs()] },
  ];
}

/** 复盘周期：周报选自然周，月报选自然月 */
function ReviewPeriodPicker({
  kind,
  from,
  today,
  onChange,
}: {
  kind: ReviewPeriodKind;
  from: string;
  today: string;
  onChange: (kind: ReviewPeriodKind, period: { from: string; to: string }) => void;
}) {
  const pick = (k: ReviewPeriodKind, date: string) => onChange(k, reviewPeriod(k, date, today));
  const last = dayjs(today).subtract(1, kind);
  return (
    <>
      <Segmented
        value={kind}
        options={[
          { value: 'week', label: '周报' },
          { value: 'month', label: '月报' },
        ]}
        onChange={(v) => pick(v as ReviewPeriodKind, today)}
      />
      <DatePicker
        picker={kind}
        allowClear={false}
        value={dayjs(from)}
        disabledDate={(d) => d.isAfter(dayjs(), 'day')}
        presets={[
          { label: kind === 'week' ? '本周' : '本月', value: dayjs(today) },
          { label: kind === 'week' ? '上周' : '上月', value: last },
        ]}
        onChange={(d) => d && pick(kind, d.format(DATE_FORMAT))}
      />
    </>
  );
}

/** 指标卡：本期数值 + 与上期相比的变化（变好绿色、变差红色） */
function KpiCard({ def, cur, prev }: { def: KpiDef; cur: number | null; prev: number | null }) {
  const { token } = theme.useToken();
  const delta = kpiDelta(def, cur, prev);
  const color =
    delta?.tone === 'good'
      ? token.colorSuccess
      : delta?.tone === 'bad'
        ? token.colorError
        : token.colorTextSecondary;
  return (
    <Card size="small" style={{ height: '100%' }}>
      <Statistic
        title={
          def.hint ? (
            <Tooltip title={def.hint}>
              <span style={{ borderBottom: '1px dashed currentColor', cursor: 'help' }}>
                {def.label}
              </span>
            </Tooltip>
          ) : (
            def.label
          )
        }
        value={formatKpi(cur, def.format)}
      />
      <Typography.Text style={{ fontSize: 12, color }}>
        {delta ? `比上期 ${delta.text}` : `上期 ${formatKpi(prev, def.format)}`}
      </Typography.Text>
    </Card>
  );
}

function defectColumns<T extends ReviewDefect>(project: ProjectDetail): ColumnsType<T> {
  return [
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
  ];
}

function ListCard<T extends ReviewDefect>({
  title,
  list,
  columns,
}: {
  title: string;
  list: { total: number; items: T[] };
  columns: ColumnsType<T>;
}) {
  return (
    <ChartCard
      title={`${title}（${list.total}）`}
      extra={
        list.total > list.items.length && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            只列出前 {list.items.length} 个
          </Typography.Text>
        )
      }
    >
      <Table<T>
        size="small"
        rowKey="code"
        pagination={false}
        dataSource={list.items}
        columns={columns}
        locale={{ emptyText: '无' }}
      />
    </ChartCard>
  );
}

function ReviewTab({
  project,
  query,
  kind,
  filters,
}: TabProps & { kind: ReviewPeriodKind; filters: string }) {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const r = useReport<ReviewReport>(project.key, 'review', query);
  const label = kind === 'month' ? '月报' : '周报';
  const icon = {
    bad: <WarningOutlined style={{ color: token.colorError }} />,
    good: <CheckCircleOutlined style={{ color: token.colorSuccess }} />,
    info: <InfoCircleOutlined style={{ color: token.colorInfo }} />,
  };
  return (
    <Loaded state={r}>
      {(d) => {
        const copy = async () => {
          const text = reviewMarkdown(d, project, {
            title: `${project.name} 缺陷${label}`,
            origin: window.location.origin,
            filters,
          });
          if (await copyText(text)) {
            message.success(`${label}已复制（Markdown），可以直接粘贴到群聊或文档`);
          } else message.error('复制失败，请检查浏览器权限');
        };
        return (
          <>
            <Space wrap style={{ marginBottom: 12 }}>
              <Typography.Text type="secondary">
                本期 {d.period.from} ~ {d.period.to}，对比上期 {d.previous.from} ~ {d.previous.to}
              </Typography.Text>
              <Button icon={<CopyOutlined />} onClick={() => void copy()}>
                复制为{label}
              </Button>
            </Space>
            <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
              {REVIEW_KPIS.map((def) => (
                <Col xs={12} md={8} xl={6} key={def.key}>
                  <KpiCard def={def} cur={d.current[def.key]} prev={d.before[def.key]} />
                </Col>
              ))}
              <Col xs={12} md={8} xl={6}>
                <Card size="small" style={{ height: '100%' }}>
                  <Statistic
                    title="当前超期"
                    value={d.overdueCount}
                    valueStyle={d.overdueCount ? { color: token.colorError } : undefined}
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    过了截止时间或超过 SLA
                  </Typography.Text>
                </Card>
              </Col>
            </Row>
            <ChartCard title="结论">
              <Space direction="vertical" size={6}>
                {reviewInsights(d, project).map((i) => (
                  <Space key={i.text} align="start" size={8}>
                    {icon[i.tone]}
                    <Typography.Text>{i.text}</Typography.Text>
                  </Space>
                ))}
              </Space>
            </ChartCard>
            <Row gutter={16}>
              <Col xs={24} xl={12}>
                <ChartCard title="各模块新增">
                  <Table
                    size="small"
                    rowKey="key"
                    pagination={false}
                    dataSource={d.modules}
                    locale={{ emptyText: '本期和上期都没有新增缺陷' }}
                    columns={[
                      {
                        title: '模块',
                        dataIndex: 'key',
                        render: (k: string) => dimensionLabel('module', k, project),
                      },
                      { title: '本期新增', dataIndex: 'created', align: 'right' },
                      { title: '上期新增', dataIndex: 'prevCreated', align: 'right' },
                      {
                        title: '变化',
                        key: 'change',
                        align: 'right',
                        render: (_, m) => {
                          const diff = m.created - m.prevCreated;
                          if (diff === 0) return '持平';
                          return (
                            <Typography.Text
                              style={{ color: diff > 0 ? token.colorError : token.colorSuccess }}
                            >
                              {diff > 0 ? `+${diff}` : `−${-diff}`}
                            </Typography.Text>
                          );
                        },
                      },
                      { title: '当前未关闭', dataIndex: 'open', align: 'right' },
                    ]}
                  />
                </ChartCard>
              </Col>
              <Col xs={24} xl={12}>
                <ChartCard title="按人：本期解决与被重开">
                  <Table
                    size="small"
                    rowKey="key"
                    pagination={false}
                    dataSource={d.developers}
                    locale={{ emptyText: '本期没有解决的缺陷' }}
                    columns={[
                      {
                        title: '开发',
                        dataIndex: 'key',
                        render: (k: string) => (k ? userName(project.members, k) : '未指派'),
                      },
                      { title: '解决', dataIndex: 'resolved', align: 'right' },
                      { title: '被重开', dataIndex: 'reopened', align: 'right' },
                      {
                        title: '重开率',
                        dataIndex: 'reopenRate',
                        align: 'right',
                        render: (v: number | null) => pct(v),
                      },
                    ]}
                  />
                </ChartCard>
              </Col>
            </Row>
            <ListCard
              title="本期新增致命 / 严重缺陷"
              list={d.lists.serious}
              columns={defectColumns(project)}
            />
            <ListCard
              title="当前超期缺陷"
              list={d.lists.overdue}
              columns={[
                ...defectColumns<ReviewReport['lists']['overdue']['items'][number]>(project),
                {
                  title: '超期',
                  key: 'over',
                  width: 170,
                  render: (_, o) => (
                    <Typography.Text type="danger">
                      {overdueText(o.reason, o.overHours)}
                    </Typography.Text>
                  ),
                },
              ]}
            />
            <ListCard
              title="本期被重新打开的缺陷"
              list={d.lists.reopened}
              columns={[
                ...defectColumns(project),
                {
                  title: '累计重开',
                  dataIndex: 'reopenCount',
                  width: 90,
                  align: 'right',
                  render: (n: number) => `${n} 次`,
                },
              ]}
            />
          </>
        );
      }}
    </Loaded>
  );
}

/** 关闭结论的显示名：解决方式，或未填解决方式时关闭到的状态 */
function outcomeLabel(key: string, project: ProjectDetail): string {
  if (key.startsWith('status:')) {
    const state = key.slice('status:'.length);
    return `${findState(project.workflow, state)?.name ?? state}（未填解决方式）`;
  }
  return RESOLUTION[key as keyof typeof RESOLUTION] ?? key;
}

const COMPLETENESS_FIELDS = [
  { key: 'rootCause', label: '缺陷根源' },
  { key: 'bugType', label: '缺陷类型' },
  { key: 'moduleId', label: '模块' },
  { key: 'versionFoundId', label: '发现版本' },
] as const;

function ProcessTab({ project, query }: TabProps) {
  const r = useReport<ProcessReport>(project.key, 'process', query);
  const stageName = (key: string) => (key ? (SEVERITY[key as Severity] ?? key) : '全部');
  const hours = (v: number | null) => duration(v);
  return (
    <Loaded state={r}>
      {(d) => {
        const waiting = d.verifiers.reduce((n, v) => n + v.waiting, 0);
        const stageRows = [...d.stages.rows, d.stages.total].map((s) => ({
          name: stageName(s.key),
          wait: s.waitHours,
          fix: s.fixHours,
          verify: s.verifyHours,
        }));
        return (
          <>
            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
              <Col xs={12} md={6}>
                <Stat title="关闭的缺陷" value={d.outcome.closed} hint="时间段内关闭" />
              </Col>
              <Col xs={12} md={6}>
                <Stat
                  title="无效缺陷率"
                  value={pct(d.outcome.invalidRate)}
                  hint={`${d.outcome.invalid} 个重复、设计如此、无法重现等`}
                />
              </Col>
              <Col xs={12} md={6}>
                <Stat
                  title="平均全程"
                  value={duration(d.stages.total.leadHours)}
                  hint="有效缺陷从创建到关闭，工作日计时"
                />
              </Col>
              <Col xs={12} md={6}>
                <Stat title="待验证积压" value={waiting} hint="当前处于待验证的缺陷" />
              </Col>
            </Row>
            <ChartCard title="各环节平均耗时（时间段内关闭的有效缺陷）">
              {d.stages.total.count === 0 ? (
                <Empty description="时间段内没有关闭的有效缺陷" />
              ) : (
                <>
                  <EChart option={stageOption(stageRows)} height={60 + stageRows.length * 40} />
                  <Table<StageRow>
                    size="small"
                    rowKey="key"
                    pagination={false}
                    dataSource={d.stages.rows}
                    columns={[
                      { title: '严重程度', dataIndex: 'key', render: stageName },
                      { title: '关闭数', dataIndex: 'count', align: 'right' },
                      { title: '等待处理', dataIndex: 'waitHours', align: 'right', render: hours },
                      { title: '修复', dataIndex: 'fixHours', align: 'right', render: hours },
                      { title: '验证', dataIndex: 'verifyHours', align: 'right', render: hours },
                      { title: '全程', dataIndex: 'leadHours', align: 'right', render: hours },
                    ]}
                    summary={() => (
                      <Table.Summary.Row>
                        <Table.Summary.Cell index={0}>
                          <Typography.Text strong>合计</Typography.Text>
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={1} align="right">
                          {d.stages.total.count}
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={2} align="right">
                          {hours(d.stages.total.waitHours)}
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={3} align="right">
                          {hours(d.stages.total.fixHours)}
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={4} align="right">
                          {hours(d.stages.total.verifyHours)}
                        </Table.Summary.Cell>
                        <Table.Summary.Cell index={5} align="right">
                          {hours(d.stages.total.leadHours)}
                        </Table.Summary.Cell>
                      </Table.Summary.Row>
                    )}
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    等待处理 = 创建 → 开始处理，修复 = 开始处理 → 首次解决，验证 = 首次解决 →
                    关闭（含被打回后的返工），均按工作日计时
                  </Typography.Text>
                </>
              )}
            </ChartCard>
            <Row gutter={16}>
              <Col xs={24} xl={12}>
                <ChartCard title="关闭结论分布">
                  {d.outcome.closed === 0 ? (
                    <Empty description="时间段内没有关闭的缺陷" />
                  ) : (
                    <EChart
                      option={barsOption(
                        d.outcome.resolutions.map((i) => ({
                          name: outcomeLabel(i.key, project),
                          count: i.count,
                        })),
                      )}
                      height={Math.max(160, 40 + d.outcome.resolutions.length * 28)}
                    />
                  )}
                </ChartCard>
              </Col>
              <Col xs={24} xl={12}>
                <ChartCard title="数据完整度（时间段内关闭的有效缺陷）">
                  {d.completeness.total === 0 ? (
                    <Empty description="时间段内没有关闭的有效缺陷" />
                  ) : (
                    <>
                      {COMPLETENESS_FIELDS.map((f) => {
                        const n = d.completeness[f.key];
                        return (
                          <div key={f.key} style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
                            <Typography.Text style={{ width: 72, flex: 'none' }}>
                              {f.label}
                            </Typography.Text>
                            <Progress
                              percent={Math.round((n / d.completeness.total) * 100)}
                              format={() => `${n}/${d.completeness.total}`}
                              style={{ flex: 1, margin: 0 }}
                            />
                          </div>
                        );
                      })}
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        字段填得越全，分布、根因等报表越能看出问题；可在工作流里把它们设为解决时必填
                      </Typography.Text>
                    </>
                  )}
                </ChartCard>
              </Col>
            </Row>
            <ChartCard title="提单质量（时间段内新建，按创建人）">
              <Table
                size="small"
                rowKey="key"
                pagination={false}
                dataSource={d.reporters}
                locale={{ emptyText: '时间段内没有新建的缺陷' }}
                columns={[
                  {
                    title: '创建人',
                    dataIndex: 'key',
                    render: (k: string) => (k ? userName(project.members, k) : 'APP 反馈 / 系统'),
                  },
                  { title: '新建', dataIndex: 'created', align: 'right' },
                  { title: '致命 / 严重', dataIndex: 'serious', align: 'right' },
                  { title: '已关闭', dataIndex: 'closed', align: 'right' },
                  { title: '无效', dataIndex: 'invalid', align: 'right' },
                  {
                    title: '无效率',
                    dataIndex: 'invalidRate',
                    align: 'right',
                    render: (v: number | null) => pct(v),
                  },
                  { title: '未关闭', dataIndex: 'open', align: 'right' },
                ]}
              />
            </ChartCard>
            <ChartCard title="验证（按验证人）">
              <Table
                size="small"
                rowKey="key"
                pagination={false}
                dataSource={d.verifiers}
                locale={{ emptyText: '没有待验证或时间段内验证过的缺陷' }}
                columns={[
                  {
                    title: '验证人',
                    dataIndex: 'key',
                    render: (k: string) => (k ? userName(project.members, k) : '未指派'),
                  },
                  { title: '待验证', dataIndex: 'waiting', align: 'right' },
                  {
                    title: '最久等待',
                    dataIndex: 'oldestWaitDays',
                    align: 'right',
                    render: (n: number, row) => (row.waiting ? `${n} 天` : '—'),
                  },
                  { title: '本期验证', dataIndex: 'verified', align: 'right' },
                  {
                    title: '平均验证时长',
                    dataIndex: 'avgVerifyHours',
                    align: 'right',
                    render: hours,
                  },
                ]}
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                待验证按当前处理人统计；本期验证按缺陷的验证人统计，未设置验证人时算创建人
              </Typography.Text>
            </ChartCard>
          </>
        );
      }}
    </Loaded>
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
                  title: '重开率',
                  dataIndex: 'reopenRate',
                  align: 'right',
                  sorter: (a, b) => (a.reopenRate ?? -1) - (b.reopenRate ?? -1),
                  render: (v: number | null, row) =>
                    row.resolveCount ? `${pct(v)}（${row.reopened}/${row.resolveCount}）` : '—',
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
                    {data.total.resolveCount
                      ? `${pct(data.total.reopenRate)}（${data.total.reopened}/${data.total.resolveCount}）`
                      : '—'}
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="right">
                    {data.total.slaTotal
                      ? `${pct(data.total.slaRate)}（${data.total.slaMet}/${data.total.slaTotal}）`
                      : '—'}
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={5} align="right">
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
