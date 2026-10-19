import { PlusOutlined, ProjectOutlined, ReloadOutlined } from '@ant-design/icons';
import { PRIORITY_OPTIONS, SEVERITY_OPTIONS } from '@defect/shared';
import { Button, Input, Result, Segmented, Select, Space, Table, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useDefects, useProject } from '../../api/hooks';
import type { DefectRow } from '../../api/types';
import { PriorityTag, SeverityTag, SourceTag, StatusTag } from '../../components/Tags';
import { UserNames } from '../../components/UserNames';
import { BUILTIN_VIEWS, DEFAULT_VIEW, buildQuery } from './views';

export function DefectListPage() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const project = useProject(key);
  const query = useMemo(() => buildQuery(params), [params]);
  const defects = useDefects(key, query);

  const update = (patch: Record<string, string | undefined>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (resetPage) next.delete('page');
    setParams(next);
  };

  if (project.isError) return <Result status="404" title="项目不存在或你不是项目成员" />;
  const p = project.data;
  const workflow = p?.workflow;
  const members = p?.members ?? [];

  const columns: ColumnsType<DefectRow> = [
    {
      title: '编号',
      dataIndex: 'code',
      width: 110,
      sorter: true,
      sortOrder: query.sort === 'seq' ? (query.order === 'asc' ? 'ascend' : 'descend') : null,
      render: (code: string) => <Link to={`/p/${key}/bugs/${code}`}>{code}</Link>,
    },
    {
      title: '标题',
      dataIndex: 'title',
      ellipsis: true,
      render: (title: string, row) => (
        <Space size={4}>
          <Link to={`/p/${key}/bugs/${row.code}`}>{title}</Link>
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
      width: 110,
      render: (s: string) => (workflow ? <StatusTag value={s} workflow={workflow} /> : s),
    },
    {
      title: '严重程度',
      dataIndex: 'severity',
      width: 96,
      render: (v: string) => <SeverityTag value={v} />,
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 90,
      render: (v: string | null) => <PriorityTag value={v} />,
    },
    {
      title: '处理人',
      dataIndex: 'ownerIds',
      width: 140,
      ellipsis: true,
      render: (ids: string[]) => <UserNames members={members} ids={ids} />,
    },
    {
      title: '模块',
      dataIndex: 'moduleId',
      width: 110,
      render: (id: string | null) => p?.modules.find((m) => m.id === id)?.name ?? '—',
    },
    {
      title: '来源',
      dataIndex: 'source',
      width: 100,
      render: (v: string) => <SourceTag value={v} />,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 140,
      sorter: true,
      sortOrder: query.sort === 'createdAt' ? (query.order === 'asc' ? 'ascend' : 'descend') : null,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
    },
  ];

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
          {p?.name ?? key} · 缺陷
        </Typography.Title>
        <div style={{ flex: 1 }} />
        <Button
          icon={<ReloadOutlined />}
          onClick={() => void defects.refetch()}
          aria-label="刷新"
        />
        <Button icon={<ProjectOutlined />} onClick={() => navigate(`/p/${key}/bugs/board`)}>
          看板
        </Button>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => navigate(`/p/${key}/bugs/new`)}
        >
          新建缺陷
        </Button>
      </div>

      <Segmented
        style={{ marginBottom: 12, maxWidth: '100%', overflowX: 'auto' }}
        value={params.get('view') ?? DEFAULT_VIEW}
        options={BUILTIN_VIEWS.map((v) => ({ value: v.key, label: v.label }))}
        onChange={(v) => update({ view: String(v) })}
      />

      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search
          allowClear
          placeholder="编号、标题、描述、日志"
          defaultValue={params.get('keyword') ?? ''}
          onSearch={(v) => update({ keyword: v.trim() || undefined })}
          style={{ width: 240 }}
        />
        <Select
          mode="multiple"
          allowClear
          placeholder="严重程度"
          style={{ minWidth: 150 }}
          value={params.get('severity')?.split(',') ?? []}
          options={SEVERITY_OPTIONS}
          onChange={(v: string[]) => update({ severity: v.join(',') || undefined })}
        />
        <Select
          mode="multiple"
          allowClear
          placeholder="优先级"
          style={{ minWidth: 150 }}
          value={params.get('priority')?.split(',') ?? []}
          options={PRIORITY_OPTIONS}
          onChange={(v: string[]) => update({ priority: v.join(',') || undefined })}
        />
        <Select
          mode="multiple"
          allowClear
          placeholder="状态"
          style={{ minWidth: 150 }}
          value={params.get('status')?.split(',') ?? []}
          options={workflow?.states.map((s) => ({ value: s.key, label: s.name })) ?? []}
          onChange={(v: string[]) => update({ status: v.join(',') || undefined })}
        />
        <Select
          allowClear
          placeholder="模块"
          style={{ minWidth: 130 }}
          value={params.get('moduleId') ?? undefined}
          options={p?.modules.map((m) => ({ value: m.id, label: m.name })) ?? []}
          onChange={(v?: string) => update({ moduleId: v })}
        />
      </Space>

      <Table<DefectRow>
        rowKey="id"
        size="middle"
        loading={defects.isFetching}
        columns={columns}
        dataSource={defects.data?.items ?? []}
        scroll={{ x: 1000 }}
        locale={{ emptyText: defects.isError ? defects.error.message : '没有符合条件的缺陷' }}
        pagination={{
          current: Number(query.page),
          pageSize: Number(query.pageSize),
          total: defects.data?.total ?? 0,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
        }}
        onChange={(pagination, _filters, sorter) => {
          const s = Array.isArray(sorter) ? sorter[0] : sorter;
          const field = s?.order ? (s.field === 'code' ? 'seq' : String(s.field)) : undefined;
          update(
            {
              page: String(pagination.current ?? 1),
              pageSize: String(pagination.pageSize ?? 20),
              sort: field,
              order: s?.order ? (s.order === 'ascend' ? 'asc' : 'desc') : undefined,
            },
            false,
          );
        }}
      />
    </div>
  );
}
