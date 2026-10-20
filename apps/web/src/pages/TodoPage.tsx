import {
  ClearOutlined,
  GroupOutlined,
  ReloadOutlined,
  SortAscendingOutlined,
} from '@ant-design/icons';
import {
  GROUP_NONE,
  PRIORITY,
  PRIORITY_OPTIONS,
  SEVERITY,
  SEVERITY_OPTIONS,
  STATUS_CATEGORY,
  TODO_GROUP_FIELDS,
  formatSort,
  type SortSpec,
  type TodoGroupField,
} from '@defect/shared';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Collapse,
  Empty,
  Input,
  Popover,
  Result,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { qk, useProjects, useTodoGroups, useTodos } from '../api/hooks';
import type { DefectRow, ProjectDetail } from '../api/types';
import { BulkEditBar, type BulkChanges, type BulkResult } from '../components/BulkEdit';
import { DefectDrawer, useDefectDrawer } from '../components/DefectDrawer';
import { SortEditor, describeSort } from '../components/SortEditor';
import { DefectTableView, type TableSelection } from './defects/DefectTable';
import { DEFAULT_SORT, readSort } from './defects/views';

/** 状态范围：默认看未完成的；类别与工作流无关，跨项目也能统一筛选 */
const STATUS_SCOPES = [
  { value: 'open', label: '未完成', categories: 'todo,doing,verifying' },
  { value: 'todo', label: '未开始', categories: 'todo' },
  { value: 'doing', label: '进行中', categories: 'doing' },
  { value: 'verifying', label: '待验证', categories: 'verifying' },
  { value: 'done', label: '已完成', categories: 'done' },
  { value: 'all', label: '全部', categories: '' },
];

const readGroupBy = (params: URLSearchParams): TodoGroupField | undefined => {
  const v = params.get('groupBy');
  return v && v in TODO_GROUP_FIELDS ? (v as TodoGroupField) : undefined;
};

/** 表格共用的参数（分组下的每个表格与不分组时的表格一样） */
interface TableShared {
  projectMap: Map<string, ProjectDetail | undefined>;
  sort: SortSpec[];
  onSort: (s: SortSpec[]) => void;
  selection: TableSelection;
  onOpen: (code: string) => void;
  activeCode?: string;
}

/**
 * 我的待办：打开平台时的首页，跨项目列出指派给我的缺陷。
 * 支持搜索、按项目 / 严重程度 / 优先级 / 状态筛选、多字段排序、分组、行内修改与批量修改；
 * 点编号或标题在右侧半屏打开详情，列表位置保持不变。
 */
export function TodoPage() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const projects = useProjects();
  const drawer = useDefectDrawer();
  const sort = readSort(params);
  const groupBy = readGroupBy(params);
  const scope = STATUS_SCOPES.find((s) => s.value === params.get('status')) ?? STATUS_SCOPES[0]!;
  const query = useMemo(() => {
    const q: Record<string, string> = {
      page: params.get('page') ?? '1',
      pageSize: params.get('pageSize') ?? '20',
      sort: formatSort(sort),
    };
    if (scope.categories) q.statusCategory = scope.categories;
    for (const k of ['keyword', 'project', 'severity', 'priority']) {
      const v = params.get(k);
      if (v) q[k] = v;
    }
    return q;
  }, [params, scope, sort]);
  const base = useMemo(() => {
    const { page: _p, pageSize: _s, ...rest } = query;
    return rest;
  }, [query]);
  const todos = useTodos(query);
  const [sortOpen, setSortOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<DefectRow[]>([]);
  const filterKey = JSON.stringify({ ...base, groupBy });
  useEffect(() => setSelectedRows([]), [filterKey]);

  // 行内编辑需要各项目的成员、模块与工作流；我所在的项目通常不多，一次取齐
  const keys = (projects.data ?? []).map((p) => p.key);
  const details = useQueries({
    queries: keys.map((k) => ({
      queryKey: qk.project(k),
      queryFn: () => api<ProjectDetail>(`/projects/${k}`),
      staleTime: 60_000,
    })),
  });
  const projectMap = new Map(keys.map((k, i) => [k, details[i]?.data]));
  const selectedProjects = [...new Set(selectedRows.map((r) => r.project?.key))];

  const update = (patch: Record<string, string | undefined>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (resetPage) next.delete('page');
    setParams(next);
  };
  const setSort = (s: SortSpec[]) =>
    update({ sort: formatSort(s) === formatSort(DEFAULT_SORT) ? undefined : formatSort(s) });
  const hasConditions = [
    'keyword',
    'project',
    'severity',
    'priority',
    'status',
    'sort',
    'groupBy',
  ].some((k) => params.get(k));

  /** 勾选跨多个项目时按项目分别提交，汇总结果 */
  const applyBulk = async (changes: BulkChanges): Promise<BulkResult> => {
    const byProject = new Map<string, string[]>();
    for (const r of selectedRows) {
      const k = r.project?.key;
      if (k) byProject.set(k, [...(byProject.get(k) ?? []), r.code]);
    }
    const total: BulkResult = { total: 0, updated: 0, failed: [] };
    try {
      for (const [k, codes] of byProject) {
        const r = await api<BulkResult>(`/projects/${k}/defects/bulk`, {
          method: 'POST',
          body: { codes, changes },
        });
        total.total += r.total;
        total.updated += r.updated;
        total.failed.push(...r.failed);
      }
    } finally {
      void qc.invalidateQueries({ queryKey: ['todos'] });
      void qc.invalidateQueries({ queryKey: ['defects'] });
    }
    return total;
  };

  const shared: TableShared = {
    projectMap,
    sort,
    onSort: setSort,
    onOpen: drawer.open,
    activeCode: drawer.code,
    selection: {
      keys: selectedRows.map((r) => r.code),
      // 分组时每个表格只知道自己的行，按编号合并，跨分页、跨分组保留已选的行
      onChange: (k, rows) =>
        setSelectedRows((prev) => {
          const map = new Map([...prev, ...rows].filter(Boolean).map((x) => [x.code, x]));
          return k.map((code) => map.get(code)!).filter(Boolean);
        }),
    },
  };

  return (
    <div>
      <div className="page-header">
        <Typography.Title level={4}>我的待办</Typography.Title>
        <Tag bordered={false} className="mono">
          {todos.data?.total ?? 0}
        </Tag>
        <Typography.Text type="secondary">指派给我的缺陷（我所在的全部项目）</Typography.Text>
        <div style={{ flex: 1 }} />
        <Tooltip title="刷新">
          <Button
            icon={<ReloadOutlined />}
            aria-label="刷新"
            onClick={() => void qc.invalidateQueries({ queryKey: ['todos'] })}
          />
        </Tooltip>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <Input.Search
          allowClear
          placeholder="编号、标题、描述（空格分隔多个词）"
          defaultValue={params.get('keyword') ?? ''}
          key={params.get('keyword') ?? ''}
          onSearch={(v) => update({ keyword: v.trim() || undefined })}
          style={{ width: 260 }}
        />
        <Select
          value={scope.value}
          style={{ width: 120 }}
          options={STATUS_SCOPES.map((s) => ({ value: s.value, label: s.label }))}
          onChange={(v: string) => update({ status: v === 'open' ? undefined : v })}
        />
        <Select
          mode="multiple"
          allowClear
          maxTagCount="responsive"
          placeholder="项目"
          style={{ width: 180 }}
          value={params.get('project')?.split(',') ?? []}
          options={(projects.data ?? []).map((p) => ({ value: p.key, label: p.name }))}
          onChange={(v: string[]) => update({ project: v.join(',') || undefined })}
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
          options={Object.entries(TODO_GROUP_FIELDS).map(([value, label]) => ({
            value,
            label: `按${label}分组`,
          }))}
          onChange={(v?: string) => update({ groupBy: v })}
        />
        {hasConditions && (
          <Button
            type="text"
            icon={<ClearOutlined />}
            onClick={() => setParams(new URLSearchParams())}
          >
            清空条件
          </Button>
        )}
      </div>

      <BulkEditBar
        project={selectedProjects.length === 1 ? projectMap.get(selectedProjects[0]!) : undefined}
        selectedCount={selectedRows.length}
        onClear={() => setSelectedRows([])}
        onApply={applyBulk}
      />

      {groupBy ? (
        <TodoGroups base={base} groupBy={groupBy} shared={shared} />
      ) : (
        <DefectTableView
          {...shared}
          rows={todos.data?.items ?? []}
          total={todos.data?.total ?? 0}
          loading={todos.isFetching}
          error={todos.isError ? todos.error.message : undefined}
          projectOf={(row) => (row.project ? projectMap.get(row.project.key) : undefined)}
          showProject
          page={Number(query.page)}
          pageSize={Number(query.pageSize)}
          onPage={(page, pageSize) =>
            update({ page: String(page), pageSize: String(pageSize) }, false)
          }
        />
      )}

      <DefectDrawer code={drawer.code} onClose={drawer.close} />
    </div>
  );
}

/** 分组浏览：先取每组数量，展开某组时再按该组分页取数 */
function TodoGroups({
  base,
  groupBy,
  shared,
}: {
  base: Record<string, string>;
  groupBy: TodoGroupField;
  shared: TableShared;
}) {
  const groups = useTodoGroups({ ...base, groupBy }, true);
  if (groups.isLoading) return <Spin style={{ display: 'block', margin: '48px auto' }} />;
  if (groups.isError) return <Result status="warning" title={groups.error.message} />;
  if (!groups.data?.groups.length) return <Empty description="没有指派给你的缺陷" />;
  return (
    <Collapse
      // 分组方式变了重新挂载，默认展开前两组
      key={groupBy}
      defaultActiveKey={groups.data.groups.slice(0, 2).map((g) => g.value)}
      items={groups.data.groups.map((g) => ({
        key: g.value,
        label: (
          <Space>
            <Typography.Text strong>{todoGroupLabel(groupBy, g.value, g.label)}</Typography.Text>
            <Tag bordered={false}>{g.count}</Tag>
          </Space>
        ),
        styles: { body: { padding: 0 } },
        children: <TodoGroupTable base={base} groupBy={groupBy} value={g.value} shared={shared} />,
      }))}
    />
  );
}

function TodoGroupTable({
  base,
  groupBy,
  value,
  shared,
}: {
  base: Record<string, string>;
  groupBy: TodoGroupField;
  value: string;
  shared: TableShared;
}) {
  const [paging, setPaging] = useState({ page: 1, pageSize: 10 });
  const todos = useTodos({
    ...base,
    groupField: groupBy,
    groupValue: value,
    page: String(paging.page),
    pageSize: String(paging.pageSize),
  });
  return (
    <DefectTableView
      {...shared}
      compact
      rows={todos.data?.items ?? []}
      total={todos.data?.total ?? 0}
      loading={todos.isFetching}
      error={todos.isError ? todos.error.message : undefined}
      projectOf={(row) => (row.project ? shared.projectMap.get(row.project.key) : undefined)}
      showProject={groupBy !== 'project'}
      page={paging.page}
      pageSize={paging.pageSize}
      onPage={(page, pageSize) => setPaging({ page, pageSize })}
    />
  );
}

function todoGroupLabel(field: TodoGroupField, value: string, label?: string): string {
  if (value === GROUP_NONE) return '未设置';
  switch (field) {
    case 'project':
      return label ?? value;
    case 'statusCategory':
      return STATUS_CATEGORY[value as keyof typeof STATUS_CATEGORY] ?? value;
    case 'severity':
      return SEVERITY[value as keyof typeof SEVERITY] ?? value;
    case 'priority':
      return PRIORITY[value as keyof typeof PRIORITY] ?? value;
  }
}
