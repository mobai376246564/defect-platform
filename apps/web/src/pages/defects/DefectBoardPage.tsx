import { ReloadOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { SEVERITY_OPTIONS, STATUS_CATEGORY, type WorkflowTransition } from '@defect/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Input,
  Result,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Typography,
} from 'antd';
import { useMemo, useState, type DragEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { qk, useDefects, useProject } from '../../api/hooks';
import type { DefectRow, ProjectDetail } from '../../api/types';
import { DefectDrawer, useDefectDrawer } from '../../components/DefectDrawer';
import { SeverityTag } from '../../components/Tags';
import { TransitionModal, type TransitionSubmit } from '../../components/TransitionModal';
import { UserNames } from '../../components/UserNames';
import { BOARD_LIMIT, boardColumns, dropTransition, needsForm } from './board';

/** 缺陷看板（方案 6.6）：列 = 工作流状态，拖拽卡片到另一列即发起流转。 */
export function DefectBoardPage() {
  const { key = '' } = useParams();
  const project = useProject(key);
  if (project.isError) return <Result status="404" title="项目不存在或你不是项目成员" />;
  if (!project.data) return <Spin style={{ display: 'block', marginTop: 80 }} />;
  return <Board project={project.data} />;
}

function Board({ project }: { project: ProjectDetail }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const drawer = useDefectDrawer();
  const [owner, setOwner] = useState<'all' | 'me'>('all');
  const [moduleId, setModuleId] = useState<string>();
  const [severity, setSeverity] = useState<string[]>([]);
  const [keyword, setKeyword] = useState<string>();
  const [showDone, setShowDone] = useState(false);
  const [dragging, setDragging] = useState<DefectRow | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [pending, setPending] = useState<{ defect: DefectRow; transition: WorkflowTransition }>();

  const query = useMemo(
    () => ({
      statusCategory: showDone ? undefined : 'todo,doing,verifying',
      owner: owner === 'me' ? 'me' : undefined,
      moduleId,
      severity,
      keyword,
      sort: 'updatedAt',
      order: 'desc',
      page: 1,
      pageSize: BOARD_LIMIT,
    }),
    [showDone, owner, moduleId, severity, keyword],
  );
  const defects = useDefects(project.key, query);
  const columns = useMemo(
    () => boardColumns(project.workflow, defects.data?.items ?? []),
    [project.workflow, defects.data],
  );

  const transition = useMutation({
    mutationFn: ({ code, body }: { code: string; body: TransitionSubmit }) =>
      api(`/projects/${project.key}/defects/${code}/transitions`, { method: 'POST', body }),
    onSuccess: (_data, { code }) => {
      message.success(`${code} 已流转`);
      setPending(undefined);
      void qc.invalidateQueries({ queryKey: ['defects', project.key] });
      void qc.invalidateQueries({ queryKey: qk.defect(project.key, code) });
    },
    onError: (e: Error) => message.error(e.message),
  });

  const allowed = (columnKey: string) =>
    dragging ? dropTransition(project.workflow, project.myRole, dragging.status, columnKey) : null;

  const onDrop = (e: DragEvent, columnKey: string) => {
    e.preventDefault();
    setHover(null);
    const defect = dragging;
    setDragging(null);
    if (!defect) return;
    const t = dropTransition(project.workflow, project.myRole, defect.status, columnKey);
    if (!t) return;
    if (needsForm(t, defect)) setPending({ defect, transition: t });
    else transition.mutate({ code: defect.code, body: { transition: t.key, values: {} } });
  };

  const total = defects.data?.total ?? 0;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <Typography.Title level={4} style={{ margin: 0 }}>
          {project.name} · 看板
        </Typography.Title>
        <div style={{ flex: 1 }} />
        <Button
          icon={<ReloadOutlined />}
          onClick={() => void defects.refetch()}
          aria-label="刷新"
        />
        <Button icon={<UnorderedListOutlined />} onClick={() => navigate(`/p/${project.key}/bugs`)}>
          列表
        </Button>
      </div>

      <Space wrap style={{ marginBottom: 12 }}>
        <Segmented
          value={owner}
          options={[
            { value: 'all', label: '全部' },
            { value: 'me', label: '我处理的' },
          ]}
          onChange={(v) => setOwner(v as 'all' | 'me')}
        />
        <Input.Search
          allowClear
          placeholder="编号、标题"
          onSearch={(v) => setKeyword(v.trim() || undefined)}
          style={{ width: 200 }}
        />
        <Select
          mode="multiple"
          allowClear
          placeholder="严重程度"
          style={{ minWidth: 150 }}
          value={severity}
          options={SEVERITY_OPTIONS}
          onChange={setSeverity}
        />
        <Select
          allowClear
          placeholder="模块"
          style={{ minWidth: 130 }}
          value={moduleId}
          options={project.modules.map((m) => ({ value: m.id, label: m.name }))}
          onChange={setModuleId}
        />
        <Space size={6}>
          <Switch size="small" checked={showDone} onChange={setShowDone} />
          <Typography.Text>显示已完成</Typography.Text>
        </Space>
      </Space>

      {total > BOARD_LIMIT && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`共 ${total} 条，看板只显示最近更新的 ${BOARD_LIMIT} 条，请用筛选缩小范围`}
        />
      )}

      <div
        style={{
          display: 'flex',
          gap: 12,
          overflowX: 'auto',
          alignItems: 'flex-start',
          paddingBottom: 8,
        }}
      >
        {columns.map((col) => {
          const target = allowed(col.key);
          const isSource = dragging?.status === col.key;
          const hidden = col.category === 'done' && !showDone;
          return (
            <div
              key={col.key}
              data-testid={`column-${col.key}`}
              onDragOver={(e) => {
                if (!target) return;
                // 只有允许的流转才 preventDefault，浏览器据此显示“可放置”
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (hover !== col.key) setHover(col.key);
              }}
              onDragLeave={() => setHover((h) => (h === col.key ? null : h))}
              onDrop={(e) => onDrop(e, col.key)}
              style={{
                flex: '0 0 260px',
                background: hover === col.key ? 'var(--lane-hover)' : 'var(--lane-bg)',
                borderRadius: 6,
                padding: 8,
                border: `1px dashed ${dragging && target ? 'var(--accent)' : 'transparent'}`,
                opacity: dragging && !target && !isSource ? 0.45 : 1,
                transition: 'opacity .15s, background .15s',
              }}
            >
              <Space style={{ padding: '2px 4px 8px' }}>
                <Badge color={col.color} />
                <Typography.Text strong>{col.name}</Typography.Text>
                {!hidden && <Typography.Text type="secondary">{col.items.length}</Typography.Text>}
                {dragging && target && (
                  <Typography.Text type="secondary">· {target.label}</Typography.Text>
                )}
              </Space>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 80 }}>
                {hidden ? (
                  <Typography.Text
                    type="secondary"
                    style={{ padding: '24px 8px', textAlign: 'center' }}
                  >
                    {STATUS_CATEGORY.done}的缺陷默认隐藏，可拖入此列流转
                  </Typography.Text>
                ) : (
                  col.items.map((d) => (
                    <Card
                      key={d.id}
                      size="small"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', d.code);
                        setDragging(d);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setHover(null);
                      }}
                      style={{ cursor: 'grab', opacity: dragging?.id === d.id ? 0.5 : 1 }}
                      styles={{ body: { padding: 10 } }}
                    >
                      <Space size={6} style={{ marginBottom: 4 }}>
                        <Link
                          data-open-defect
                          to={`/p/${project.key}/bugs/${d.code}`}
                          onClick={(e) => {
                            if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
                            e.preventDefault();
                            drawer.open(d.code);
                          }}
                        >
                          {d.code}
                        </Link>
                        <SeverityTag value={d.severity} />
                      </Space>
                      <Typography.Paragraph ellipsis={{ rows: 2 }} style={{ margin: 0 }}>
                        {d.title}
                      </Typography.Paragraph>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        <UserNames members={project.members} ids={d.ownerIds} />
                      </Typography.Text>
                    </Card>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      <DefectDrawer code={drawer.code} onClose={drawer.close} />
      {pending && (
        <TransitionModal
          transition={pending.transition}
          defect={pending.defect}
          project={project}
          loading={transition.isPending}
          onCancel={() => setPending(undefined)}
          onSubmit={(body) => transition.mutate({ code: pending.defect.code, body })}
        />
      )}
    </div>
  );
}
