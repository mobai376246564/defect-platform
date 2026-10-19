import { CopyOutlined, RobotOutlined } from '@ant-design/icons';
import {
  FREQUENCY,
  PRIORITY_OPTIONS,
  RESOLUTION,
  ROOT_CAUSE,
  SEVERITY_OPTIONS,
  hasPermission,
  type WorkflowTransition,
} from '@defect/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Input,
  Result,
  Row,
  Select,
  Skeleton,
  Space,
  Tabs,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { qk, useDefect, useProject } from '../../api/hooks';
import type { DefectDetail, ProjectDetail } from '../../api/types';
import { uploadAttachments, type PendingFile } from '../../api/upload';
import { AttachmentGallery } from '../../components/AttachmentGallery';
import { AttachmentPicker } from '../../components/AttachmentPicker';
import { SeverityTag, SourceTag, StatusTag } from '../../components/Tags';
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

function DefectView({ project, defect }: { project: ProjectDetail; defect: DefectDetail }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [active, setActive] = useState<WorkflowTransition | null>(null);
  const [comment, setComment] = useState('');
  const [files, setFiles] = useState<PendingFile[]>([]);
  const base = `/projects/${project.key}/defects/${defect.code}`;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.defect(project.key, defect.code) });
    void qc.invalidateQueries({ queryKey: ['defects', project.key] });
  };
  const canEdit =
    hasPermission(project.myRole, 'defect.edit') &&
    (project.myRole !== 'developer' || defect.statusCategory === 'doing');

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

  const fieldSelect = (
    field: string,
    value: string | null,
    options: { value: string; label: string }[],
    allowClear = true,
  ) =>
    canEdit ? (
      <Select
        size="small"
        variant="borderless"
        style={{ minWidth: 120 }}
        value={value ?? undefined}
        allowClear={allowClear}
        options={options}
        onChange={(v) => patch.mutate({ [field]: v ?? null })}
      />
    ) : (
      (options.find((o) => o.value === value)?.label ?? '—')
    );

  return (
    <div>
      <Space
        align="start"
        style={{
          width: '100%',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          marginBottom: 12,
        }}
      >
        <div>
          <Typography.Text type="secondary">
            <Link to={`/p/${project.key}/bugs`}>{project.name}</Link> / {defect.code}
          </Typography.Text>
          <Typography.Title level={4} style={{ margin: '4px 0 0' }}>
            {defect.title}
          </Typography.Title>
          <Space style={{ marginTop: 8 }} wrap>
            <StatusTag value={defect.status} workflow={project.workflow} />
            <SeverityTag value={defect.severity} />
            <SourceTag value={defect.source} />
            {defect.dupCount > 0 && <Tag color="red">重复反馈 {defect.dupCount} 次</Tag>}
            {defect.reopenCount > 0 && <Tag color="orange">重新打开 {defect.reopenCount} 次</Tag>}
          </Space>
        </div>
        <Space wrap>
          {defect.transitions.map((t) => (
            <Button
              key={t.key}
              type={t.to === 'rejected' ? 'default' : 'primary'}
              onClick={() => setActive(t)}
            >
              {t.label}
            </Button>
          ))}
        </Space>
      </Space>

      <Row gutter={16}>
        <Col xs={24} lg={16}>
          <Card style={{ marginBottom: 16 }}>
            <Section title="复现步骤" text={defect.steps} />
            <Section title="期望结果" text={defect.expected} />
            <Section title="实际结果" text={defect.actual} />
            <Section title="描述" text={defect.description} />
          </Card>

          <Card title="附件" style={{ marginBottom: 16 }}>
            <AttachmentGallery projectKey={project.key} attachments={defect.attachments} />
            {hasPermission(project.myRole, 'defect.create') && (
              <div style={{ marginTop: 16 }}>
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

          {defect.logSummary && (
            <Card title="日志摘要（自动提取）" style={{ marginBottom: 16 }}>
              <pre
                style={{
                  maxHeight: 360,
                  overflow: 'auto',
                  fontSize: 12,
                  background: '#fafafa',
                  padding: 12,
                  margin: 0,
                }}
              >
                {defect.logSummary}
              </pre>
            </Card>
          )}

          <Card>
            <Tabs
              items={[
                {
                  key: 'comments',
                  label: `评论（${defect.comments.length}）`,
                  children: (
                    <Space direction="vertical" style={{ width: '100%' }}>
                      {defect.comments.map((c) => (
                        <div
                          key={c.id}
                          style={{ borderBottom: '1px solid #f0f0f0', paddingBottom: 8 }}
                        >
                          <Space size={6}>
                            <Typography.Text strong>
                              {c.via === 'system' ? '系统' : userName(project.members, c.authorId)}
                            </Typography.Text>
                            {c.via === 'claude' && (
                              <Tag icon={<RobotOutlined />} color="purple">
                                经 Claude
                              </Tag>
                            )}
                            <Typography.Text type="secondary">
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
                      <Input.TextArea
                        rows={3}
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="写评论"
                      />
                      <Button
                        type="primary"
                        disabled={!comment.trim()}
                        loading={addComment.isPending}
                        onClick={() => addComment.mutate()}
                      >
                        发表评论
                      </Button>
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
                            <Typography.Text type="secondary">
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
        </Col>

        <Col xs={24} lg={8}>
          <Card title="字段" style={{ marginBottom: 16 }}>
            <Descriptions column={1} size="small" styles={{ label: { width: 84 } }}>
              <Descriptions.Item label="严重程度">
                {fieldSelect('severity', defect.severity, SEVERITY_OPTIONS, false)}
              </Descriptions.Item>
              <Descriptions.Item label="优先级">
                {fieldSelect('priority', defect.priority, PRIORITY_OPTIONS)}
              </Descriptions.Item>
              <Descriptions.Item label="模块">
                {fieldSelect(
                  'moduleId',
                  defect.moduleId,
                  project.modules.map((m) => ({ value: m.id, label: m.name })),
                )}
              </Descriptions.Item>
              <Descriptions.Item label="处理人">
                {canEdit ? (
                  <Select
                    size="small"
                    mode="multiple"
                    variant="borderless"
                    style={{ minWidth: 160 }}
                    value={defect.ownerIds}
                    options={project.members.map((m) => ({ value: m.id, label: m.name }))}
                    onChange={(v: string[]) => patch.mutate({ ownerIds: v })}
                  />
                ) : (
                  <UserNames members={project.members} ids={defect.ownerIds} />
                )}
              </Descriptions.Item>
              <Descriptions.Item label="创建人">
                {defect.source === 'app' && !defect.reporterId
                  ? 'APP 用户'
                  : userName(project.members, defect.reporterId)}
              </Descriptions.Item>
              <Descriptions.Item label="开发人员">
                {userName(project.members, defect.developerId)}
              </Descriptions.Item>
              <Descriptions.Item label="重现规律">
                {defect.frequency ? FREQUENCY[defect.frequency as keyof typeof FREQUENCY] : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="发现版本">
                {project.versions.find((v) => v.id === defect.versionFoundId)?.name ?? '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Git commit">{defect.appCommit ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="解决方法">
                {defect.resolution ? RESOLUTION[defect.resolution as keyof typeof RESOLUTION] : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="缺陷根源">
                {defect.rootCause ? ROOT_CAUSE[defect.rootCause as keyof typeof ROOT_CAUSE] : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">
                {dayjs(defect.createdAt).format('YYYY-MM-DD HH:mm')}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          <Card
            title={
              <Space>
                <RobotOutlined />用 Claude Code 修复
              </Space>
            }
            style={{ marginBottom: 16 }}
          >
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
              在本地项目目录打开 Claude Code，粘贴下面的命令。首次使用需先接入 MCP（见
              <Link to="/me"> 个人设置</Link>）。
            </Typography.Paragraph>
            <Space.Compact style={{ width: '100%' }}>
              <Input readOnly value={defect.fixCommand} />
              <Button icon={<CopyOutlined />} onClick={() => void copy(defect.fixCommand)}>
                复制
              </Button>
            </Space.Compact>
          </Card>

          {defect.links.length > 0 && (
            <Card title="关联提交" style={{ marginBottom: 16 }}>
              {defect.links.map((l) => (
                <div key={l.id}>
                  <Tag>{l.kind}</Tag>
                  {/^https?:\/\//.test(l.target) ? (
                    <a href={l.target} target="_blank" rel="noreferrer">
                      {l.target}
                    </a>
                  ) : (
                    <Typography.Text code>{l.target}</Typography.Text>
                  )}
                </div>
              ))}
            </Card>
          )}

          {!!defect.deviceInfo && (
            <Card title="环境信息">
              <pre style={{ fontSize: 12, margin: 0, whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(defect.deviceInfo, null, 2)}
              </pre>
            </Card>
          )}
        </Col>
      </Row>

      {defect.transitions.length === 0 && defect.statusCategory !== 'done' && (
        <Alert
          style={{ marginTop: 16 }}
          type="info"
          showIcon
          message="当前状态下你的角色没有可执行的流转"
        />
      )}

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

function Section({ title, text }: { title: string; text: string }) {
  if (!text) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <Typography.Text strong>{title}</Typography.Text>
      <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0' }}>
        {text}
      </Typography.Paragraph>
    </div>
  );
}
