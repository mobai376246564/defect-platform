import { EditOutlined } from '@ant-design/icons';
import {
  PRIORITY_OPTIONS,
  SEVERITY_OPTIONS,
  freeTransitionKey,
  hasPermission,
  type SortField,
  type SortSpec,
} from '@defect/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Button, Grid, Input, Select, Space, Table, Tooltip, Typography } from 'antd';
import type { ColumnsType, SortOrder } from 'antd/es/table/interface';
import dayjs from 'dayjs';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useDefects } from '../../api/hooks';
import type { DefectRow, ProjectDetail } from '../../api/types';
import { ResizableHeaderCell, useColumnWidths } from '../../components/ResizableColumns';
import { PriorityTag, SeverityTag, SourceTag, StatusTag } from '../../components/Tags';
import { UserNames } from '../../components/UserNames';

/** 勾选状态：keys 为缺陷编号，跨分页保留 */
export interface TableSelection {
  keys: string[];
  onChange: (keys: string[], rows: DefectRow[]) => void;
}

interface ViewProps {
  rows: DefectRow[];
  total: number;
  loading: boolean;
  error?: string;
  /** 行所属项目（跨项目的“我的待办”里每行可能不同） */
  projectOf: (row: DefectRow) => ProjectDetail | undefined;
  showProject?: boolean;
  sort: SortSpec[];
  onSort: (next: SortSpec[]) => void;
  page: number;
  pageSize: number;
  onPage: (page: number, pageSize: number) => void;
  selection?: TableSelection;
  compact?: boolean;
  /** 传入时点编号或标题在右侧抽屉打开详情（按住 Ctrl / ⌘ 点击仍在新标签页打开） */
  onOpen?: (code: string) => void;
  /** 抽屉里正在查看的缺陷，所在行高亮 */
  activeCode?: string;
}

/** 普通左键点击时交给 onOpen；带修饰键或中键时保持链接的默认行为 */
const openHandler =
  (onOpen: ((code: string) => void) | undefined, code: string) => (e: React.MouseEvent) => {
    if (!onOpen || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onOpen(code);
  };

/** 各列默认宽度；标题列不设宽度，占用剩余空间 */
const DEFAULT_WIDTHS: Record<string, number> = {
  seq: 110,
  project: 120,
  status: 124,
  severity: 112,
  priority: 124,
  ownerIds: 150,
  moduleId: 120,
  source: 100,
  createdAt: 140,
  updatedAt: 140,
};
/** 标题列至少保留的宽度，屏幕放不下时横向滚动 */
const TITLE_MIN = 280;

const keyOf = (row: DefectRow, project: ProjectDetail | undefined) =>
  row.project?.key ?? project?.key ?? '';

/**
 * 缺陷表格（只负责展示与行内编辑）：标题、状态、严重程度、优先级、处理人、模块可直接在表格里改；
 * 点表头排序会替换成单字段排序（多字段排序在“排序”面板里设置）。
 */
export function DefectTableView({
  rows,
  total,
  loading,
  error,
  projectOf,
  showProject,
  sort,
  onSort,
  page,
  pageSize,
  onPage,
  selection,
  compact,
  onOpen,
  activeCode,
}: ViewProps) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const screens = Grid.useBreakpoint();
  const { widthOf, headerProps } = useColumnWidths('defect.col-widths', DEFAULT_WIDTHS);
  const refresh = (key: string) => {
    void qc.invalidateQueries({ queryKey: ['defects', key] });
    void qc.invalidateQueries({ queryKey: ['todos'] });
  };
  const patch = useMutation({
    mutationFn: (v: { key: string; code: string; body: Record<string, unknown> }) =>
      api(`/projects/${v.key}/defects/${v.code}`, { method: 'PATCH', body: v.body }),
    onSuccess: (_, v) => refresh(v.key),
    onError: (e: Error) => message.error(e.message),
  });
  const move = useMutation({
    mutationFn: (v: { key: string; code: string; to: string }) =>
      api(`/projects/${v.key}/defects/${v.code}/transitions`, {
        method: 'POST',
        body: { transition: freeTransitionKey(v.to), values: {} },
      }),
    onSuccess: (_, v) => refresh(v.key),
    onError: (e: Error) => message.error(e.message),
  });

  /** 字段可编辑：有编辑权限；开发只能改处理中的缺陷（与服务端规则一致） */
  const canEdit = (row: DefectRow, p: ProjectDetail | undefined) =>
    !!p &&
    hasPermission(p.myRole, 'defect.edit') &&
    (p.myRole !== 'developer' || row.statusCategory === 'doing');
  /** 状态可直接切换：自由流转模式下除只读成员外都可以 */
  const canMove = (p: ProjectDetail | undefined) =>
    !!p && p.workflow.mode === 'free' && p.myRole !== 'viewer';

  const sortOf = (field: SortField): SortOrder => {
    const s = sort[0];
    if (s?.field !== field) return null;
    return s.order === 'asc' ? 'ascend' : 'descend';
  };
  const sortable = (field: SortField) => ({
    sorter: true,
    sortOrder: sortOf(field),
    sortDirections: ['descend', 'ascend'] as SortOrder[],
  });
  const select = (
    row: DefectRow,
    p: ProjectDetail | undefined,
    field: string,
    value: string | null,
    options: { value: string; label: React.ReactNode }[],
    allowClear = true,
  ) => (
    <Select
      size="small"
      variant="borderless"
      className="cell-select"
      popupMatchSelectWidth={false}
      value={value ?? undefined}
      placeholder="—"
      allowClear={allowClear}
      options={options}
      onChange={(v?: string) =>
        patch.mutate({ key: keyOf(row, p), code: row.code, body: { [field]: v ?? null } })
      }
    />
  );

  const columns: ColumnsType<DefectRow> = [
    {
      title: '编号',
      dataIndex: 'code',
      key: 'seq',
      ...sortable('seq'),
      render: (code: string, row) => (
        <Link
          className="defect-code"
          to={`/p/${keyOf(row, projectOf(row))}/bugs/${code}`}
          onClick={openHandler(onOpen, code)}
        >
          {code}
        </Link>
      ),
    },
    ...(showProject
      ? [
          {
            title: '项目',
            key: 'project',
            ellipsis: true,
            render: (_: unknown, row: DefectRow) => row.project?.name ?? '—',
          },
        ]
      : []),
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (title: string, row) => {
        const p = projectOf(row);
        return (
          <EditableTitle
            title={title}
            href={`/p/${keyOf(row, p)}/bugs/${row.code}`}
            dupCount={row.dupCount}
            onClick={openHandler(onOpen, row.code)}
            editable={canEdit(row, p)}
            onSave={(next) =>
              patch.mutate({ key: keyOf(row, p), code: row.code, body: { title: next } })
            }
          />
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      // 状态按工作流顺序：第一次点击从前往后
      ...sortable('status'),
      sortDirections: ['ascend', 'descend'] as SortOrder[],
      render: (s: string, row) => {
        const p = projectOf(row);
        if (!p) return s;
        if (!canMove(p)) return <StatusTag value={s} workflow={p.workflow} />;
        return (
          <Select
            size="small"
            variant="borderless"
            className="cell-select"
            popupMatchSelectWidth={false}
            value={s}
            options={p.workflow.states.map((st) => ({
              value: st.key,
              label: <StatusTag value={st.key} workflow={p.workflow} />,
            }))}
            onChange={(to: string) => move.mutate({ key: keyOf(row, p), code: row.code, to })}
          />
        );
      },
    },
    {
      title: '严重程度',
      dataIndex: 'severity',
      key: 'severity',
      ...sortable('severity'),
      render: (v: string, row) => {
        const p = projectOf(row);
        return canEdit(row, p) ? (
          select(
            row,
            p,
            'severity',
            v,
            SEVERITY_OPTIONS.map((o) => ({
              value: o.value,
              label: <SeverityTag value={o.value} />,
            })),
            false,
          )
        ) : (
          <SeverityTag value={v} />
        );
      },
    },
    {
      title: '优先级',
      responsive: ['sm'],
      dataIndex: 'priority',
      key: 'priority',
      ...sortable('priority'),
      render: (v: string | null, row) => {
        const p = projectOf(row);
        return canEdit(row, p) ? (
          select(
            row,
            p,
            'priority',
            v,
            PRIORITY_OPTIONS.map((o) => ({
              value: o.value,
              label: <PriorityTag value={o.value} />,
            })),
          )
        ) : (
          <PriorityTag value={v} />
        );
      },
    },
    {
      title: '处理人',
      responsive: ['md'],
      dataIndex: 'ownerIds',
      key: 'ownerIds',
      render: (ids: string[], row) => {
        const p = projectOf(row);
        if (!canEdit(row, p)) return <UserNames members={p?.members ?? []} ids={ids} />;
        return (
          <Select
            size="small"
            mode="multiple"
            variant="borderless"
            className="cell-select"
            maxTagCount={1}
            popupMatchSelectWidth={false}
            placeholder="未指派"
            value={ids}
            optionFilterProp="label"
            options={p!.members.map((m) => ({ value: m.id, label: m.name }))}
            onChange={(v: string[]) =>
              patch.mutate({ key: keyOf(row, p), code: row.code, body: { ownerIds: v } })
            }
          />
        );
      },
    },
    {
      title: '模块',
      responsive: ['lg'],
      dataIndex: 'moduleId',
      key: 'moduleId',
      render: (id: string | null, row) => {
        const p = projectOf(row);
        if (!canEdit(row, p)) return p?.modules.find((m) => m.id === id)?.name ?? '—';
        return select(
          row,
          p,
          'moduleId',
          id,
          p!.modules.map((m) => ({ value: m.id, label: m.name })),
        );
      },
    },
    {
      title: '来源',
      responsive: ['xxl'],
      dataIndex: 'source',
      key: 'source',
      render: (v: string) => <SourceTag value={v} />,
    },
    {
      title: '创建时间',
      responsive: ['xl'],
      dataIndex: 'createdAt',
      key: 'createdAt',
      ...sortable('createdAt'),
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '更新时间',
      responsive: ['xxl'],
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      ...sortable('updatedAt'),
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
    },
  ];

  // 套上当前列宽与表头拖动分隔线；按屏幕宽度去掉被 responsive 隐藏的列来估算横向滚动宽度
  const sized = columns.map((c) => {
    const key = String(c.key);
    if (!(key in DEFAULT_WIDTHS)) return c;
    return { ...c, width: widthOf(key), onHeaderCell: () => headerProps(key) };
  });
  const scrollX =
    TITLE_MIN +
    (selection ? 32 : 0) +
    sized
      .filter((c) => !c.responsive || c.responsive.some((b) => screens[b]))
      .reduce((sum, c) => sum + (typeof c.width === 'number' ? c.width : 0), 0);

  return (
    <Table<DefectRow>
      rowKey="code"
      rowClassName={(r) => (r.code === activeCode ? 'row-active' : '')}
      size={compact ? 'small' : 'middle'}
      loading={loading}
      columns={sized}
      components={{ header: { cell: ResizableHeaderCell } }}
      dataSource={rows}
      tableLayout="fixed"
      scroll={{ x: scrollX }}
      locale={{ emptyText: error ?? '没有符合条件的缺陷' }}
      rowSelection={
        selection && {
          selectedRowKeys: selection.keys,
          preserveSelectedRowKeys: true,
          onChange: (keys, selected) => selection.onChange(keys as string[], selected),
        }
      }
      pagination={{
        current: page,
        pageSize,
        total,
        showSizeChanger: true,
        size: compact ? 'small' : 'default',
        showTotal: (t) => `共 ${t} 条`,
      }}
      onChange={(pagination, _filters, sorter, extra) => {
        if (extra.action === 'sort') {
          const s = Array.isArray(sorter) ? sorter[0] : sorter;
          const field = s?.columnKey as SortField | undefined;
          onSort(
            s?.order && field
              ? [{ field, order: s.order === 'ascend' ? 'asc' : 'desc' }]
              : [{ field: 'createdAt', order: 'desc' }],
          );
          return;
        }
        onPage(pagination.current ?? 1, pagination.pageSize ?? pageSize);
      }}
    />
  );
}

/** 标题：点链接进详情，点铅笔图标在表格里直接改 */
function EditableTitle({
  title,
  href,
  dupCount,
  onClick,
  editable,
  onSave,
}: {
  title: string;
  href: string;
  dupCount: number;
  onClick: (e: React.MouseEvent) => void;
  editable: boolean;
  onSave: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  if (editing) {
    const commit = () => {
      setEditing(false);
      const next = draft.trim();
      if (next && next !== title) onSave(next);
    };
    return (
      <Input
        size="small"
        autoFocus
        maxLength={120}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onPressEnter={commit}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  return (
    <div className="cell-title">
      <Link to={href} className="cell-title-link" onClick={onClick}>
        {title}
      </Link>
      {dupCount > 0 && (
        <Tooltip title={`又收到 ${dupCount} 条相同反馈`}>
          <Typography.Text type="danger">+{dupCount}</Typography.Text>
        </Tooltip>
      )}
      {editable && (
        <Button
          size="small"
          type="text"
          className="cell-edit"
          icon={<EditOutlined />}
          aria-label="修改标题"
          onClick={() => {
            setDraft(title);
            setEditing(true);
          }}
        />
      )}
    </div>
  );
}

/** 单个项目的缺陷表格：按给定查询取一页数据。列表页与分组下的每一组都用它。 */
export function DefectTable({
  projectKey,
  project,
  query,
  ...rest
}: Omit<ViewProps, 'rows' | 'total' | 'loading' | 'error' | 'projectOf'> & {
  projectKey: string;
  project: ProjectDetail | undefined;
  query: Record<string, string>;
}) {
  const defects = useDefects(projectKey, {
    ...query,
    page: String(rest.page),
    pageSize: String(rest.pageSize),
  });
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={0}>
      <DefectTableView
        {...rest}
        rows={defects.data?.items ?? []}
        total={defects.data?.total ?? 0}
        loading={defects.isFetching}
        error={defects.isError ? defects.error.message : undefined}
        projectOf={() => project}
      />
    </Space>
  );
}
