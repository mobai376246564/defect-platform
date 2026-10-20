import {
  ClearOutlined,
  DeleteOutlined,
  FilterOutlined,
  GroupOutlined,
  PlusOutlined,
  ProjectOutlined,
  ReloadOutlined,
  SaveOutlined,
  SortAscendingOutlined,
} from '@ant-design/icons';
import {
  BUG_TYPE,
  DEFECT_SOURCE,
  GROUP_FIELDS,
  GROUP_NONE,
  PRIORITY,
  PRIORITY_OPTIONS,
  SEVERITY,
  SEVERITY_OPTIONS,
  STATUS_CATEGORY,
  formatSort,
  hasPermission,
  type FilterGroup,
  type GroupField,
  type SortSpec,
} from '@defect/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Badge,
  Button,
  Checkbox,
  Collapse,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Popover,
  Result,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { qk, useDefectGroups, useDefects, useProject, useSavedViews } from '../../api/hooks';
import type { ProjectDetail, SavedViewItem } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { BulkEditBar, type BulkChanges, type BulkResult } from '../../components/BulkEdit';
import { FilterBuilder } from '../../components/FilterBuilder';
import { SortEditor, describeSort } from '../../components/SortEditor';
import { DefectCreateModal } from './DefectCreateModal';
import { DefectDrawer, useDefectDrawer } from '../../components/DefectDrawer';
import { DefectTable, type TableSelection } from './DefectTable';
import {
  BUILTIN_VIEWS,
  DEFAULT_SORT,
  DEFAULT_VIEW,
  SAVED_PREFIX,
  applySavedView,
  buildQuery,
  readFilters,
  readGroupBy,
  readSort,
  savedParams,
} from './views';

export function DefectListPage() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const project = useProject(key);
  const views = useSavedViews(key);
  const query = useMemo(() => buildQuery(params), [params]);
  const filters = readFilters(params);
  const sort = readSort(params);
  const groupBy = readGroupBy(params);
  const viewKey = params.get('view') ?? DEFAULT_VIEW;
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const qc = useQueryClient();
  const drawer = useDefectDrawer();
  // 勾选：跨分页保留；“选择全部筛选结果”时按当前筛选条件批量修改
  const [selected, setSelected] = useState<string[]>([]);
  const [allMatching, setAllMatching] = useState(false);
  const filterKey = JSON.stringify({ ...query, page: undefined, pageSize: undefined });
  useEffect(() => {
    setSelected([]);
    setAllMatching(false);
  }, [filterKey]);
  // 与表格同一个查询，react-query 会复用结果，用于显示筛选结果总数；分组视图下表格不用它，不发这个请求
  const listForTotal = useDefects(key, query, !groupBy);
  const groupTotal = useDefectGroups(
    key,
    { ...query, page: undefined, pageSize: undefined, groupBy },
    !!groupBy,
  );
  const selection = {
    keys: selected,
    onChange: (keys: string[]) => {
      setSelected(keys);
      setAllMatching(false);
    },
  };
  const applyBulk = (changes: BulkChanges) => {
    const { page: _p, pageSize: _s, ...filters } = query;
    return api<BulkResult>(`/projects/${key}/defects/bulk`, {
      method: 'POST',
      body: allMatching ? { query: filters, changes } : { codes: selected, changes },
    }).finally(() => {
      void qc.invalidateQueries({ queryKey: ['defects', key] });
      void qc.invalidateQueries({ queryKey: ['todos'] });
    });
  };

  const update = (patch: Record<string, string | undefined>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (resetPage) next.delete('page');
    setParams(next);
  };
  const setFilters = (f: FilterGroup | undefined) =>
    update({ filters: f ? JSON.stringify(f) : undefined });
  const setSort = (s: SortSpec[]) =>
    update({ sort: formatSort(s) === formatSort(DEFAULT_SORT) ? undefined : formatSort(s) });

  if (project.isError) return <Result status="404" title="项目不存在或你不是项目成员" />;
  const p = project.data;
  const activeSaved = viewKey.startsWith(SAVED_PREFIX)
    ? views.data?.find((v) => `${SAVED_PREFIX}${v.id}` === viewKey)
    : undefined;
  const hasConditions =
    !!filters ||
    !!groupBy ||
    !!params.get('sort') ||
    ['keyword', 'severity', 'priority', 'status', 'moduleId'].some((k) => params.get(k));

  const viewTabs = [
    ...BUILTIN_VIEWS.map((v) => ({ key: v.key, label: v.label })),
    ...(views.data ?? []).map((v) => ({
      key: `${SAVED_PREFIX}${v.id}`,
      label: (
        <span>
          {v.name}
          {v.shared && (
            <Tag bordered={false} color="processing" style={{ marginInlineStart: 6 }}>
              公开
            </Tag>
          )}
        </span>
      ),
    })),
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <Typography.Title level={4} style={{ margin: 0 }}>
          {p?.name ?? key} · 缺陷
        </Typography.Title>
        <div style={{ flex: 1 }} />
        <Tooltip title="刷新">
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void qc.invalidateQueries({ queryKey: ['defects', key] })}
            aria-label="刷新"
          />
        </Tooltip>
        <Button icon={<ProjectOutlined />} onClick={() => navigate(`/p/${key}/bugs/board`)}>
          看板
        </Button>
        {p && hasPermission(p.myRole, 'defect.create') && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => update({ create: '1' }, false)}
          >
            新建缺陷
          </Button>
        )}
      </div>

      <Tabs
        size="small"
        activeKey={viewTabs.some((t) => t.key === viewKey) ? viewKey : DEFAULT_VIEW}
        items={viewTabs}
        onChange={(k) => {
          if (k.startsWith(SAVED_PREFIX)) {
            const v = views.data?.find((x) => `${SAVED_PREFIX}${x.id}` === k);
            if (v) setParams(applySavedView(params, v.id, v.query));
          } else {
            update({ view: k === DEFAULT_VIEW ? undefined : k });
          }
        }}
        tabBarExtraContent={
          <Space size={4}>
            {activeSaved && p && (
              <SavedViewActions projectKey={key} project={p} view={activeSaved} params={params} />
            )}
            <Button
              size="small"
              type="text"
              icon={<SaveOutlined />}
              onClick={() => setSaveOpen(true)}
            >
              另存为视图
            </Button>
          </Space>
        }
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <Input.Search
          allowClear
          placeholder="编号、标题、描述、日志"
          defaultValue={params.get('keyword') ?? ''}
          key={params.get('keyword') ?? ''}
          onSearch={(v) => update({ keyword: v.trim() || undefined })}
          style={{ width: 220 }}
        />
        <Select
          mode="multiple"
          allowClear
          maxTagCount="responsive"
          placeholder="严重程度"
          style={{ width: 150 }}
          value={params.get('severity')?.split(',') ?? []}
          options={SEVERITY_OPTIONS}
          onChange={(v: string[]) => update({ severity: v.join(',') || undefined })}
        />
        <Select
          mode="multiple"
          allowClear
          maxTagCount="responsive"
          placeholder="优先级"
          style={{ width: 140 }}
          value={params.get('priority')?.split(',') ?? []}
          options={PRIORITY_OPTIONS}
          onChange={(v: string[]) => update({ priority: v.join(',') || undefined })}
        />
        <Select
          mode="multiple"
          allowClear
          maxTagCount="responsive"
          placeholder="状态"
          style={{ width: 150 }}
          value={params.get('status')?.split(',') ?? []}
          options={p?.workflow.states.map((s) => ({ value: s.key, label: s.name })) ?? []}
          onChange={(v: string[]) => update({ status: v.join(',') || undefined })}
        />
        <Select
          allowClear
          placeholder="模块"
          style={{ width: 130 }}
          value={params.get('moduleId') ?? undefined}
          options={p?.modules.map((m) => ({ value: m.id, label: m.name })) ?? []}
          onChange={(v?: string) => update({ moduleId: v })}
        />
        <Popover
          trigger="click"
          placement="bottomLeft"
          open={filterOpen}
          onOpenChange={setFilterOpen}
          destroyOnHidden
          title="组合筛选"
          content={
            <FilterBuilder
              project={p}
              value={filters}
              onApply={(f) => {
                setFilters(f);
                setFilterOpen(false);
              }}
            />
          }
        >
          <Badge count={filters?.conditions.length ?? 0} size="small">
            <Button icon={<FilterOutlined />}>筛选</Button>
          </Badge>
        </Popover>
        <Popover
          trigger="click"
          placement="bottomLeft"
          open={sortOpen}
          onOpenChange={setSortOpen}
          destroyOnHidden
          title="排序"
          content={
            <SortEditor
              value={sort}
              onApply={(s) => {
                setSort(s);
                setSortOpen(false);
              }}
            />
          }
        >
          <Tooltip title={describeSort(sort)}>
            <Button icon={<SortAscendingOutlined />}>排序</Button>
          </Tooltip>
        </Popover>
        <Select
          allowClear
          placeholder={
            <span>
              <GroupOutlined /> 分组
            </span>
          }
          style={{ width: 150 }}
          value={groupBy}
          options={Object.entries(GROUP_FIELDS).map(([value, label]) => ({
            value,
            label: `按${label}分组`,
          }))}
          onChange={(v?: string) => update({ groupBy: v })}
        />
        {hasConditions && (
          <Button
            type="text"
            icon={<ClearOutlined />}
            onClick={() => {
              const next = new URLSearchParams();
              const view = params.get('view');
              if (view && !view.startsWith(SAVED_PREFIX)) next.set('view', view);
              setParams(next);
            }}
          >
            清空条件
          </Button>
        )}
      </div>

      {p && hasPermission(p.myRole, 'defect.edit') && (
        <BulkEditBar
          project={p}
          selectedCount={selected.length}
          matchingTotal={groupBy ? groupTotal.data?.total : listForTotal.data?.total}
          allMatching={allMatching}
          onSelectAllMatching={() => setAllMatching(true)}
          onClear={() => {
            setSelected([]);
            setAllMatching(false);
          }}
          onApply={applyBulk}
        />
      )}

      {groupBy ? (
        <GroupedDefects
          projectKey={key}
          project={p}
          query={query}
          groupBy={groupBy}
          sort={sort}
          onSort={setSort}
          selection={p && hasPermission(p.myRole, 'defect.edit') ? selection : undefined}
          onOpen={drawer.open}
          activeCode={drawer.code}
        />
      ) : (
        <DefectTable
          projectKey={key}
          project={p}
          query={query}
          sort={sort}
          onSort={setSort}
          selection={p && hasPermission(p.myRole, 'defect.edit') ? selection : undefined}
          onOpen={drawer.open}
          activeCode={drawer.code}
          page={Number(query.page)}
          pageSize={Number(query.pageSize)}
          onPage={(page, pageSize) =>
            update({ page: String(page), pageSize: String(pageSize) }, false)
          }
        />
      )}

      <DefectDrawer code={drawer.code} onClose={drawer.close} />
      <DefectCreateModal
        projectKey={key}
        project={p}
        open={params.get('create') === '1'}
        onClose={() => update({ create: undefined }, false)}
      />
      {p && (
        <SaveViewModal
          projectKey={key}
          project={p}
          open={saveOpen}
          params={params}
          onClose={() => setSaveOpen(false)}
          onSaved={(v) => setParams(applySavedView(params, v.id, v.query))}
        />
      )}
    </div>
  );
}

/** 分组浏览：先取每组数量，展开某组时再按该组分页取数 */
function GroupedDefects({
  projectKey,
  project,
  query,
  groupBy,
  sort,
  onSort,
  selection,
  onOpen,
  activeCode,
}: {
  projectKey: string;
  project: ProjectDetail | undefined;
  query: Record<string, string>;
  groupBy: GroupField;
  sort: SortSpec[];
  onSort: (s: SortSpec[]) => void;
  selection?: TableSelection;
  onOpen: (code: string) => void;
  activeCode?: string;
}) {
  const base = Object.fromEntries(
    Object.entries(query).filter(([k]) => k !== 'page' && k !== 'pageSize'),
  );
  const groups = useDefectGroups(projectKey, { ...base, groupBy }, true);
  const [pages, setPages] = useState<Record<string, { page: number; pageSize: number }>>({});

  if (groups.isLoading) return <Spin style={{ display: 'block', margin: '48px auto' }} />;
  if (groups.isError) return <Result status="warning" title={groups.error.message} />;
  if (!groups.data?.groups.length) return <Empty description="没有符合条件的缺陷" />;

  return (
    <Collapse
      defaultActiveKey={groups.data.groups.slice(0, 2).map((g) => g.value)}
      items={groups.data.groups.map((g) => {
        const paging = pages[g.value] ?? { page: 1, pageSize: 10 };
        return {
          key: g.value,
          label: (
            <Space>
              <Typography.Text strong>{groupLabel(groupBy, g.value, project)}</Typography.Text>
              <Tag bordered={false}>{g.count}</Tag>
            </Space>
          ),
          styles: { body: { padding: 0 } },
          children: (
            <DefectTable
              compact
              projectKey={projectKey}
              project={project}
              query={{ ...base, groupField: groupBy, groupValue: g.value }}
              sort={sort}
              onSort={onSort}
              selection={selection}
              onOpen={onOpen}
              activeCode={activeCode}
              page={paging.page}
              pageSize={paging.pageSize}
              onPage={(page, pageSize) => setPages({ ...pages, [g.value]: { page, pageSize } })}
            />
          ),
        };
      })}
    />
  );
}

function groupLabel(field: GroupField, value: string, project: ProjectDetail | undefined): string {
  if (value === GROUP_NONE) return field === 'owner' ? '未指派' : '未设置';
  const member = () => project?.members.find((m) => m.id === value)?.name ?? '已移除成员';
  switch (field) {
    case 'status':
      return project?.workflow.states.find((s) => s.key === value)?.name ?? value;
    case 'statusCategory':
      return STATUS_CATEGORY[value as keyof typeof STATUS_CATEGORY] ?? value;
    case 'severity':
      return SEVERITY[value as keyof typeof SEVERITY] ?? value;
    case 'priority':
      return PRIORITY[value as keyof typeof PRIORITY] ?? value;
    case 'source':
      return DEFECT_SOURCE[value as keyof typeof DEFECT_SOURCE] ?? value;
    case 'bugType':
      return BUG_TYPE[value as keyof typeof BUG_TYPE] ?? value;
    case 'moduleId':
      return project?.modules.find((m) => m.id === value)?.name ?? '已删除模块';
    case 'versionFoundId':
      return project?.versions.find((v) => v.id === value)?.name ?? value;
    case 'owner':
    case 'reporterId':
    case 'developerId':
      return member();
  }
}

function SaveViewModal({
  projectKey,
  project,
  open,
  params,
  onClose,
  onSaved,
}: {
  projectKey: string;
  project: ProjectDetail;
  open: boolean;
  params: URLSearchParams;
  onClose: () => void;
  onSaved: (v: SavedViewItem) => void;
}) {
  const [form] = Form.useForm<{ name: string; shared?: boolean }>();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (v: { name: string; shared: boolean }) =>
      api<SavedViewItem>(`/projects/${projectKey}/views`, {
        method: 'POST',
        body: { ...v, query: savedParams(params) },
      }),
    onSuccess: (v) => {
      message.success('视图已保存');
      void qc.invalidateQueries({ queryKey: qk.views(projectKey) });
      form.resetFields();
      onClose();
      onSaved(v);
    },
    onError: (e: Error) => message.error(e.message),
  });

  return (
    <Modal
      title="另存为视图"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={save.isPending}
      width={420}
    >
      <Typography.Paragraph type="secondary">
        保存当前的筛选、排序和分组，之后在视图标签里一键切换。
      </Typography.Paragraph>
      <Form
        form={form}
        layout="vertical"
        onFinish={(v) => save.mutate({ name: v.name, shared: !!v.shared })}
      >
        <Form.Item name="name" label="视图名称" rules={[{ required: true, max: 30 }]}>
          <Input placeholder="如：本周致命问题" />
        </Form.Item>
        {hasPermission(project.myRole, 'view.publish') && (
          <Form.Item name="shared" valuePropName="checked" style={{ marginBottom: 0 }}>
            <Checkbox>公开给项目所有成员</Checkbox>
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}

/** 当前自定义视图：用当前条件覆盖保存，或删除 */
function SavedViewActions({
  projectKey,
  project,
  view,
  params,
}: {
  projectKey: string;
  project: ProjectDetail;
  view: SavedViewItem;
  params: URLSearchParams;
}) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [, setParams] = useSearchParams();
  const canEdit = view.ownerId === user?.id || hasPermission(project.myRole, 'view.publish');
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.views(projectKey) });
  const overwrite = useMutation({
    mutationFn: () =>
      api(`/projects/${projectKey}/views/${view.id}`, {
        method: 'PATCH',
        body: { query: savedParams(params) },
      }),
    onSuccess: () => {
      message.success('视图已更新');
      refresh();
    },
    onError: (e: Error) => message.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => api(`/projects/${projectKey}/views/${view.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      message.success('视图已删除');
      refresh();
      setParams(new URLSearchParams());
    },
    onError: (e: Error) => message.error(e.message),
  });
  if (!canEdit) return null;
  return (
    <>
      <Button
        size="small"
        type="text"
        loading={overwrite.isPending}
        onClick={() => overwrite.mutate()}
      >
        保存修改
      </Button>
      <Popconfirm title={`删除视图「${view.name}」？`} onConfirm={() => remove.mutate()}>
        <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label="删除视图" />
      </Popconfirm>
    </>
  );
}
