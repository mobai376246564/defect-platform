import { CopyOutlined, LinkOutlined, RobotOutlined } from '@ant-design/icons';
import {
  BUG_TYPE,
  FREQUENCY,
  PRIORITY_OPTIONS,
  RESOLUTION,
  ROOT_CAUSE,
  SEVERITY_OPTIONS,
  hasPermission,
  isFieldVisible,
  type DetailField,
  type WorkflowTransition,
} from '@defect/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Badge,
  Button,
  Card,
  Collapse,
  Empty,
  Input,
  Mentions,
  Result,
  Select,
  Skeleton,
  Space,
  Tabs,
  Tag,
  Timeline,
  Tooltip,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { qk, useDefect, useProject } from '../../api/hooks';
import type { DefectDetail, ProjectDetail } from '../../api/types';
import { uploadAttachments, type PendingFile } from '../../api/upload';
import { AttachmentGallery } from '../../components/AttachmentGallery';
import { AttachmentPicker } from '../../components/AttachmentPicker';
import { PriorityTag, SeverityTag, SourceTag } from '../../components/Tags';
import { TransitionModal, type TransitionSubmit } from '../../components/TransitionModal';
import { UserNames, userName } from '../../components/UserNames';
import { describeHistory } from './history';

export function DefectDetailPage() {
  const { key = '', code = '' } = useParams();
  const project = useProject(key);
  const defect = useDefect(key, code);

  if (defect.isError)
    return (
      <Result
        status="404"
        title={defect.error.message}
        extra={<Link to={`/p/${key}/bugs`}>返回列表</Link>}
      />
    );
  if (!defect.data || !project.data) return <Skeleton active paragraph={{ rows: 12 }} />;
  return <DefectView project={project.data} defect={defect.data} />;
}

const time = (v: string | null | undefined) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '—');
const label = (dict: Record<string, string>, v: string | null) => (v ? (dict[v] ?? v) : '—');

function DefectView({ project, defect }: { project: ProjectDetail; defect: DefectDetail }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [active, setActive] = useState<WorkflowTransition | null>(null);
  const [comment, setComment] = useState('');
  const [files, setFiles] = useState<PendingFile[]>([]);
  // 吸顶标题区的实际高度（标题换行、窄屏时会变），侧栏吸顶时据此让开
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(96);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeaderHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const base = `/projects/${project.key}/defects/${defect.code}`;
  const show = (f: DetailField) => isFieldVisible(project.hiddenFields, f);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.defect(project.key, defect.code) });
    void qc.invalidateQueries({ queryKey: ['defects', project.key] });
  };
  const canEdit =
    hasPermission(project.myRole, 'defect.edit') &&
    (project.myRole !== 'developer' || defect.statusCategory === 'doing');
  const free = project.workflow.mode === 'free';

  const transition = useMutation({
    mutationFn: (v: TransitionSubmit) => api(`${base}/transitions`, { method: 'POST', body: v }),
    onSuccess: () => {
      message.success('状态已更新');
      setActive(null);
      refresh();
    },
    onError: (e: Error) => message.error(e.message),
  });
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(base, { method: 'PATCH', body }),
    onSuccess: refresh,
    onError: (e: Error) => message.error(e.message),
  });
  const addComment = useMutation({
    mutationFn: () => api(`${base}/comments`, { method: 'POST', body: { body: comment } }),
    onSuccess: () => {
      setComment('');
      refresh();
    },
    onError: (e: Error) => message.error(e.message),
  });
  const upload = useMutation({
    mutationFn: () => uploadAttachments(project.key, defect.code, files),
    onSuccess: () => {
      setFiles([]);
      message.success('附件已上传');
      refresh();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success('已复制');
    } catch {
      message.info(text);
    }
  };

  const editableSelect = (
    field: string,
    value: string | null,
    options: { value: string; label: string }[],
    allowClear = true,
  ) =>
    canEdit ? (
      <Select
        size="small"
        variant="borderless"
        className="attr-select"
        value={value ?? undefined}
        placeholder="—"
        allowClear={allowClear}
        options={options}
        onChange={(v) => patch.mutate({ [field]: v ?? null })}
      />
    ) : (
      (options.find((o) => o.value === value)?.label ?? '—')
    );

  // 属性区：只列出管理员开启显示的字段
  const allAttrs: { field: DetailField; label: string; value: ReactNode }[] = [
    {
      field: 'severity',
      label: '严重程度',
      value: canEdit ? (
        editableSelect('severity', defect.severity, SEVERITY_OPTIONS, false)
      ) : (
        <SeverityTag value={defect.severity} />
      ),
    },
    {
      field: 'priority',
      label: '优先级',
      value: canEdit ? (
        editableSelect('priority', defect.priority, PRIORITY_OPTIONS)
      ) : (
        <PriorityTag value={defect.priority} />
      ),
    },
    {
      field: 'moduleId',
      label: '模块',
      value: editableSelect(
        'moduleId',
        defect.moduleId,
        project.modules.map((m) => ({ value: m.id, label: m.name })),
      ),
    },
    {
      field: 'ownerIds',
      label: '处理人',
      value: canEdit ? (
        <Select
          size="small"
          mode="multiple"
          variant="borderless"
          className="attr-select"
          placeholder="未指派"
          value={defect.ownerIds}
          optionFilterProp="label"
          options={project.members.map((m) => ({ value: m.id, label: m.name }))}
          onChange={(v: string[]) => patch.mutate({ ownerIds: v })}
        />
      ) : (
        <UserNames members={project.members} ids={defect.ownerIds} />
      ),
    },
    {
      field: 'reporterId',
      label: '创建人',
      value:
        defect.source === 'app' && !defect.reporterId
          ? 'APP 用户'
          : userName(project.members, defect.reporterId),
    },
    {
      field: 'developerId',
      label: '开发人员',
      value: userName(project.members, defect.developerId),
    },
    { field: 'verifierId', label: '验证人', value: userName(project.members, defect.verifierId) },
    { field: 'frequency', label: '重现规律', value: label(FREQUENCY, defect.frequency) },
    { field: 'bugType', label: '缺陷类型', value: label(BUG_TYPE, defect.bugType) },
    {
      field: 'versionFoundId',
      label: '发现版本',
      value: project.versions.find((v) => v.id === defect.versionFoundId)?.name ?? '—',
    },
    {
      field: 'versionFixedId',
      label: '修复版本',
      value: project.versions.find((v) => v.id === defect.versionFixedId)?.name ?? '—',
    },
    {
      field: 'appCommit',
      label: 'Git commit',
      value: defect.appCommit ? <Typography.Text code>{defect.appCommit}</Typography.Text> : '—',
    },
    { field: 'resolution', label: '解决方法', value: label(RESOLUTION, defect.resolution) },
    { field: 'rootCause', label: '缺陷根源', value: label(ROOT_CAUSE, defect.rootCause) },
    { field: 'dueAt', label: '截止时间', value: time(defect.dueAt) },
    { field: 'source', label: '来源', value: <SourceTag value={defect.source} /> },
    { field: 'createdAt', label: '创建时间', value: time(defect.createdAt) },
    { field: 'updatedAt', label: '更新时间', value: time(defect.updatedAt) },
  ];
  const attrs = allAttrs.filter((a) => show(a.field));

  const sections = (
    [
      ['steps', '复现步骤', defect.steps],
      ['expected', '期望结果', defect.expected],
      ['actual', '实际结果', defect.actual],
      ['description', '描述', defect.description],
    ] as const
  ).filter(([f, , text]) => show(f) && text.trim());
  const env = show('deviceInfo') ? readEnv(defect.deviceInfo) : null;
  const hasSide = attrs.length > 0 || show('claude') || !!env;

  return (
    <div style={{ '--defect-header-h': `${headerHeight}px` } as CSSProperties}>
      {/* 标题区：编号、标题、状态，滚动时吸顶 */}
      <div className="defect-header" ref={headerRef}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            <Link to={`/p/${project.key}/bugs`}>{project.name}</Link>
            <span style={{ margin: '0 6px' }}>/</span>
            <span className="mono">{defect.code}</span>
          </Typography.Text>
          <Typography.Title level={4} style={{ margin: '4px 0 8px' }}>
            {defect.title}
          </Typography.Title>
          <Space size={[6, 6]} wrap>
            {show('severity') && <SeverityTag value={defect.severity} />}
            {show('priority') && defect.priority && <PriorityTag value={defect.priority} />}
            {show('source') && <SourceTag value={defect.source} />}
            {defect.dupCount > 0 && (
              <Tag color="red" bordered={false}>
                重复反馈 {defect.dupCount} 次
              </Tag>
            )}
            {defect.reopenCount > 0 && (
              <Tag color="orange" bordered={false}>
                重新打开 {defect.reopenCount} 次
              </Tag>
            )}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {defect.source === 'app' && !defect.reporterId
                ? 'APP 用户'
                : userName(project.members, defect.reporterId)}{' '}
              创建于 {time(defect.createdAt)}
            </Typography.Text>
          </Space>
        </div>
        <StatusControl
          project={project}
          defect={defect}
          free={free}
          loading={transition.isPending}
          onFree={(t) => transition.mutate({ transition: t.key, values: {} })}
          onStrict={setActive}
        />
      </div>

      <div className={hasSide ? 'defect-layout' : 'defect-layout single'}>
        <div className="defect-main">
          {(sections.length > 0 ||
            ['steps', 'expected', 'actual', 'description'].some((f) => show(f as DetailField))) && (
            <Card title="问题描述">
              {sections.length ? (
                <div className="defect-sections">
                  {sections.map(([f, title, text]) => (
                    <div
                      key={f}
                      className={f === 'expected' || f === 'actual' ? 'half' : undefined}
                    >
                      <div className="section-label">{title}</div>
                      <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                        {text}
                      </Typography.Paragraph>
                    </div>
                  ))}
                </div>
              ) : (
                <Typography.Text type="secondary">暂无描述</Typography.Text>
              )}
            </Card>
          )}

          {show('attachments') && (
            <Card
              title={
                <Space>
                  附件
                  <Badge count={defect.attachments.length} showZero color="var(--accent)" />
                </Space>
              }
            >
              {defect.attachments.length > 0 && (
                <AttachmentGallery projectKey={project.key} attachments={defect.attachments} />
              )}
              {hasPermission(project.myRole, 'defect.create') && (
                <div style={{ marginTop: defect.attachments.length ? 16 : 0 }}>
                  <AttachmentPicker value={files} onChange={setFiles} />
                  {files.length > 0 && (
                    <Button
                      type="primary"
                      style={{ marginTop: 8 }}
                      loading={upload.isPending}
                      onClick={() => upload.mutate()}
                    >
                      上传 {files.length} 个附件
                    </Button>
                  )}
                </div>
              )}
            </Card>
          )}

          {show('logSummary') && defect.logSummary && (
            <Card
              title="日志摘要"
              extra={<Typography.Text type="secondary">自动提取</Typography.Text>}
            >
              <pre className="code-block">{defect.logSummary}</pre>
            </Card>
          )}

          {show('links') && defect.links.length > 0 && (
            <Card title="关联提交">
              <Space direction="vertical" style={{ width: '100%' }} size={6}>
                {defect.links.map((l) => (
                  <div
                    key={l.id}
                    style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}
                  >
                    <Tag bordered={false} style={{ margin: 0 }}>
                      {l.kind}
                    </Tag>
                    {l.state && <Tag bordered={false}>{l.state}</Tag>}
                    {/^https?:\/\//.test(l.target) ? (
                      <Typography.Link href={l.target} target="_blank" ellipsis>
                        <LinkOutlined /> {l.target}
                      </Typography.Link>
                    ) : (
                      <Typography.Text code ellipsis>
                        {l.target}
                      </Typography.Text>
                    )}
                  </div>
                ))}
              </Space>
            </Card>
          )}

          <Card>
            <Tabs
              items={[
                {
                  key: 'comments',
                  label: `评论（${defect.comments.length}）`,
                  children: (
                    <Space direction="vertical" style={{ width: '100%' }} size={12}>
                      {defect.comments.length === 0 && (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有评论" />
                      )}
                      {defect.comments.map((c) => (
                        <div key={c.id} className="comment-item">
                          <Space size={6}>
                            <Typography.Text strong>
                              {c.via === 'system' ? '系统' : userName(project.members, c.authorId)}
                            </Typography.Text>
                            {c.via === 'claude' && (
                              <Tag icon={<RobotOutlined />} color="purple" bordered={false}>
                                经 Claude
                              </Tag>
                            )}
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              {dayjs(c.createdAt).format('MM-DD HH:mm')}
                            </Typography.Text>
                          </Space>
                          <Typography.Paragraph
                            style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0' }}
                          >
                            {c.body}
                          </Typography.Paragraph>
                        </div>
                      ))}
                      <Mentions
                        rows={3}
                        value={comment}
                        onChange={setComment}
                        placeholder="写评论，输入 @ 提及成员（对方会收到通知）"
                        options={project.members.map((m) => ({ value: m.name, label: m.name }))}
                      />
                      <div>
                        <Button
                          type="primary"
                          disabled={!comment.trim()}
                          loading={addComment.isPending}
                          onClick={() => addComment.mutate()}
                        >
                          发表评论
                        </Button>
                      </div>
                    </Space>
                  ),
                },
                {
                  key: 'history',
                  label: '变更历史',
                  children: (
                    <Timeline
                      items={defect.history.map((h) => ({
                        children: (
                          <span>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              {dayjs(h.createdAt).format('MM-DD HH:mm')}{' '}
                            </Typography.Text>
                            {h.via === 'system' ? '系统' : userName(project.members, h.operatorId)}
                            {h.via === 'claude' && '（经 Claude）'} {describeHistory(h, project)}
                          </span>
                        ),
                      }))}
                    />
                  ),
                },
              ]}
            />
          </Card>
        </div>

        {hasSide && (
          <div className="defect-side">
            {attrs.length > 0 && (
              <Card title="属性" size="small">
                <dl className="attr-list">
                  {attrs.map((a) => (
                    <div key={a.field} className="attr-row">
                      <dt>{a.label}</dt>
                      <dd>{a.value}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            )}

            {show('claude') && (
              <Card
                size="small"
                title={
                  <Space>
                    <RobotOutlined />用 Claude Code 修复
                  </Space>
                }
              >
                <Typography.Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 12 }}>
                  在本地项目目录打开 Claude Code 粘贴命令；首次使用先在
                  <Link to="/me">个人设置</Link>接入 MCP。
                </Typography.Paragraph>
                <Space.Compact style={{ width: '100%' }}>
                  <Input readOnly value={defect.fixCommand} className="mono" />
                  <Tooltip title="复制">
                    <Button icon={<CopyOutlined />} onClick={() => void copy(defect.fixCommand)} />
                  </Tooltip>
                </Space.Compact>
              </Card>
            )}

            {env && (
              <Card title="环境信息" size="small">
                <dl className="attr-list">
                  {env.rows.map(([k, v]) => (
                    <div key={k} className="attr-row">
                      <dt>{k}</dt>
                      <dd style={{ wordBreak: 'break-all' }}>{v}</dd>
                    </div>
                  ))}
                </dl>
                <Collapse
                  ghost
                  size="small"
                  items={[
                    {
                      key: 'raw',
                      label: '原始数据',
                      children: (
                        <pre className="code-block" style={{ maxHeight: 240 }}>
                          {JSON.stringify(defect.deviceInfo, null, 2)}
                        </pre>
                      ),
                    },
                  ]}
                />
              </Card>
            )}
          </div>
        )}
      </div>

      <TransitionModal
        transition={active}
        defect={defect}
        project={project}
        loading={transition.isPending}
        onCancel={() => setActive(null)}
        onSubmit={(v) => transition.mutate(v)}
      />
    </div>
  );
}

/** 状态：自由流转用下拉框直接切换；经典工作流显示流转按钮（可能需要填写字段或说明） */
function StatusControl({
  project,
  defect,
  free,
  loading,
  onFree,
  onStrict,
}: {
  project: ProjectDetail;
  defect: DefectDetail;
  free: boolean;
  loading: boolean;
  onFree: (t: WorkflowTransition) => void;
  onStrict: (t: WorkflowTransition) => void;
}) {
  const current = project.workflow.states.find((s) => s.key === defect.status);
  const dot = (color: string) => <span className="status-dot" style={{ background: color }} />;
  if (free) {
    const options = [
      {
        value: defect.status,
        label: current?.name ?? defect.status,
        color: current?.color ?? '#999',
      },
      ...defect.transitions.map((t) => ({
        value: t.key,
        label: t.label,
        color: project.workflow.states.find((s) => s.key === t.to)?.color ?? '#999',
      })),
    ];
    return (
      <div className="status-control">
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          状态
        </Typography.Text>
        <Select
          value={defect.status}
          loading={loading}
          disabled={defect.transitions.length === 0}
          style={{ width: 160 }}
          options={options.map((o) => ({
            value: o.value,
            label: (
              <Space size={8}>
                {dot(o.color)}
                {o.label}
              </Space>
            ),
          }))}
          onChange={(key: string) => {
            const t = defect.transitions.find((x) => x.key === key);
            if (t) onFree(t);
          }}
        />
      </div>
    );
  }
  return (
    <div className="status-control">
      <Space size={8}>
        {current && dot(current.color)}
        <Typography.Text strong>{current?.name ?? defect.status}</Typography.Text>
      </Space>
      <Space wrap>
        {defect.transitions.map((t) => (
          <Button key={t.key} type="primary" ghost onClick={() => onStrict(t)}>
            {t.label}
          </Button>
        ))}
      </Space>
    </div>
  );
}

/** 把 APP 反馈的设备信息整理成可读的键值对；没有可展示内容时返回 null */
function readEnv(info: unknown): { rows: [string, ReactNode][] } | null {
  if (!info || typeof info !== 'object') return null;
  const i = info as {
    app?: { version?: string; build?: string; commit?: string; channel?: string };
    device?: { model?: string; os?: string; network?: string };
    context?: { page?: string; trail?: string[] };
  };
  const rows: [string, ReactNode][] = [];
  if (i.app?.version)
    rows.push(['APP 版本', `${i.app.version}${i.app.build ? `（${i.app.build}）` : ''}`]);
  if (i.app?.channel) rows.push(['渠道', i.app.channel]);
  if (i.app?.commit) rows.push(['代码版本', <span className="mono">{i.app.commit}</span>]);
  if (i.device?.model) rows.push(['设备', i.device.model]);
  if (i.device?.os) rows.push(['系统', i.device.os]);
  if (i.device?.network) rows.push(['网络', i.device.network]);
  if (i.context?.page) rows.push(['页面', <span className="mono">{i.context.page}</span>]);
  if (i.context?.trail?.length) rows.push(['操作路径', i.context.trail.join(' → ')]);
  return rows.length ? { rows } : null;
}
