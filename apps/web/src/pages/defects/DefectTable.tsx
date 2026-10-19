import type { SortField, SortSpec } from '@defect/shared';
import { Space, Table, Tooltip, Typography } from 'antd';
import type { ColumnsType, SortOrder } from 'antd/es/table/interface';
import dayjs from 'dayjs';
import { Link } from 'react-router-dom';
import { useDefects } from '../../api/hooks';
import type { DefectRow, ProjectDetail } from '../../api/types';
import { PriorityTag, SeverityTag, SourceTag, StatusTag } from '../../components/Tags';
import { UserNames } from '../../components/UserNames';

/**
 * 缺陷表格：按给定查询取一页数据。列表页与分组下的每一组都用它。
 * 点表头排序会替换成单字段排序（多字段排序在“排序”面板里设置）。
 */
export function DefectTable({
  projectKey,
  project,
  query,
  sort,
  onSort,
  page,
  pageSize,
  onPage,
  compact,
}: {
  projectKey: string;
  project: ProjectDetail | undefined;
  query: Record<string, string>;
  sort: SortSpec[];
  onSort: (next: SortSpec[]) => void;
  page: number;
  pageSize: number;
  onPage: (page: number, pageSize: number) => void;
  compact?: boolean;
}) {
  const defects = useDefects(projectKey, {
    ...query,
    page: String(page),
    pageSize: String(pageSize),
  });
  const workflow = project?.workflow;
  const members = project?.members ?? [];

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

  const columns: ColumnsType<DefectRow> = [
    {
      title: '编号',
      dataIndex: 'code',
      key: 'seq',
      width: 110,
      ...sortable('seq'),
      render: (code: string) => (
        <Link className="defect-code" to={`/p/${projectKey}/bugs/${code}`}>
          {code}
        </Link>
      ),
    },
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (title: string, row) => (
        <Space size={4}>
          <Link to={`/p/${projectKey}/bugs/${row.code}`}>{title}</Link>
          {row.dupCount > 0 && (
            <Tooltip title={`又收到 ${row.dupCount} 条相同反馈`}>
              <Typography.Text type="danger">+{row.dupCount}</Typography.Text>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (s: string) => (workflow ? <StatusTag value={s} workflow={workflow} /> : s),
    },
    {
      title: '严重程度',
      dataIndex: 'severity',
      key: 'severity',
      width: 104,
      ...sortable('severity'),
      render: (v: string) => <SeverityTag value={v} />,
    },
    {
      title: '优先级',
      responsive: ['sm'],
      dataIndex: 'priority',
      key: 'priority',
      width: 96,
      ...sortable('priority'),
      render: (v: string | null) => <PriorityTag value={v} />,
    },
    {
      title: '处理人',
      responsive: ['md'],
      dataIndex: 'ownerIds',
      key: 'ownerIds',
      width: 140,
      ellipsis: true,
      render: (ids: string[]) => <UserNames members={members} ids={ids} />,
    },
    {
      title: '模块',
      responsive: ['lg'],
      dataIndex: 'moduleId',
      key: 'moduleId',
      width: 110,
      ellipsis: true,
      render: (id: string | null) => project?.modules.find((m) => m.id === id)?.name ?? '—',
    },
    {
      title: '来源',
      responsive: ['xl'],
      dataIndex: 'source',
      key: 'source',
      width: 100,
      render: (v: string) => <SourceTag value={v} />,
    },
    {
      title: '创建时间',
      responsive: ['lg'],
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 150,
      ...sortable('createdAt'),
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '更新时间',
      responsive: ['xxl'],
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 150,
      ...sortable('updatedAt'),
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
    },
  ];

  return (
    <Table<DefectRow>
      rowKey="id"
      size={compact ? 'small' : 'middle'}
      loading={defects.isFetching}
      columns={columns}
      dataSource={defects.data?.items ?? []}
      scroll={{ x: 960 }}
      locale={{ emptyText: defects.isError ? defects.error.message : '没有符合条件的缺陷' }}
      pagination={{
        current: page,
        pageSize,
        total: defects.data?.total ?? 0,
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
