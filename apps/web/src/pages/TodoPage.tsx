import { ClearOutlined, ReloadOutlined, SortAscendingOutlined } from '@ant-design/icons';
import { PRIORITY_OPTIONS, SEVERITY_OPTIONS, formatSort, type SortSpec } from '@defect/shared';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Popover, Select, Tag, Tooltip, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { qk, useProjects, useTodos } from '../api/hooks';
import type { DefectRow, ProjectDetail } from '../api/types';
import { BulkEditBar, type BulkChanges, type BulkResult } from '../components/BulkEdit';
import { SortEditor, describeSort } from '../components/SortEditor';
import { DefectTableView } from './defects/DefectTable';
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

/**
 * 我的待办：打开平台时的首页，跨项目列出指派给我的缺陷。
 * 支持搜索、按项目 / 严重程度 / 优先级 / 状态筛选、多字段排序、行内修改与批量修改。
 */
export function TodoPage() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const projects = useProjects();
  const sort = readSort(params);
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
  const todos = useTodos(query);
  const [sortOpen, setSortOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedRows, setSelectedRows] = useState<DefectRow[]>([]);
  const filterKey = JSON.stringify({ ...query, page: undefined, pageSize: undefined });
  useEffect(() => {
    setSelected([]);
    setSelectedRows([]);
  }, [filterKey]);

  // 行内编辑需要每个项目的成员、模块与工作流
  const rows = todos.data?.items ?? [];
  const keys = [
    ...new Set([...rows, ...selectedRows].map((r) => r.project?.key).filter(Boolean)),
  ] as string[];
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
  const hasConditions = ['keyword', 'project', 'severity', 'priority', 'status', 'sort'].some((k) =>
    params.get(k),
  );

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
          placeholder="编号、标题、描述"
          defaultValue={params.get('keyword') ?? ''}
          key={params.get('keyword') ?? ''}
          onSearch={(v) => update({ keyword: v.trim() || undefined })}
          style={{ width: 220 }}
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
        selectedCount={selected.length}
        onClear={() => {
          setSelected([]);
          setSelectedRows([]);
        }}
        onApply={applyBulk}
      />

      <DefectTableView
        rows={rows}
        total={todos.data?.total ?? 0}
        loading={todos.isFetching}
        error={todos.isError ? todos.error.message : undefined}
        projectOf={(row) => (row.project ? projectMap.get(row.project.key) : undefined)}
        showProject
        sort={sort}
        onSort={setSort}
        page={Number(query.page)}
        pageSize={Number(query.pageSize)}
        onPage={(page, pageSize) =>
          update({ page: String(page), pageSize: String(pageSize) }, false)
        }
        selection={{
          keys: selected,
          onChange: (k, r) => {
            setSelected(k);
            // 跨分页保留已选行的项目信息
            setSelectedRows((prev) => {
              const map = new Map([...prev, ...r].filter(Boolean).map((x) => [x.code, x]));
              return k.map((code) => map.get(code)!).filter(Boolean);
            });
          },
        }}
      />
    </div>
  );
}
