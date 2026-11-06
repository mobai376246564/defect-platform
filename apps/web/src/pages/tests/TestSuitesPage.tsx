import {
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FileExcelOutlined,
  ReloadOutlined,
  RobotOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { hasPermission } from '@defect/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { qk, useProject, useTestSuites } from '../../api/hooks';
import type { TestSuiteItem } from '../../api/types';
import { copyText } from '../../components/clipboard';
import { downloadSuiteExcel, ResultStats, uploadSuiteExcel } from './common';

/**
 * 用例库：一份需求文档一个用例文件。可以用 Claude 按文档生成，也可以上传团队格式的 Excel。
 */
export function TestSuitesPage() {
  const { key = '' } = useParams();
  const project = useProject(key);
  const suites = useTestSuites(key);
  const canManage = hasPermission(project.data?.myRole, 'test.manage');
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [uploading, setUploading] = useState(false);
  const [genOpen, setGenOpen] = useState(false);

  const refresh = () => void qc.invalidateQueries({ queryKey: qk.tests(key) });

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const created = await uploadSuiteExcel(key, file);
      message.success(`已导入「${created.name}」，共 ${created.total} 条用例`);
      refresh();
      void navigate(`/p/${key}/tests/${created.id}`);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const remove = async (s: TestSuiteItem) => {
    try {
      await api(`/projects/${key}/tests/suites/${s.id}`, { method: 'DELETE' });
      message.success(`已删除「${s.name}」`);
      refresh();
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const columns: ColumnsType<TestSuiteItem> = [
    {
      title: '用例文件',
      dataIndex: 'name',
      ellipsis: true,
      render: (v: string, r) => (
        <Space>
          <FileExcelOutlined style={{ color: '#217346' }} />
          <Link to={`/p/${key}/tests/${r.id}`}>{v}</Link>
        </Space>
      ),
    },
    { title: '需求文档', dataIndex: 'docName', width: 200, ellipsis: true },
    {
      title: '用例数',
      dataIndex: 'total',
      width: 150,
      render: (v: number, r) => (
        <span className="mono">
          {v} 条 · {r.sheetCount} 个模块
        </span>
      ),
    },
    {
      title: '测试进度',
      dataIndex: 'stats',
      width: 300,
      render: (v: TestSuiteItem['stats']) => <ResultStats stats={v} />,
    },
    {
      title: '轮次',
      dataIndex: 'round',
      width: 70,
      render: (v: number) => `第 ${v} 轮`,
    },
    { title: '创建人', dataIndex: 'createdByName', width: 90 },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 110,
      render: (v: string) => <span className="mono">{dayjs(v).format('MM-DD HH:mm')}</span>,
    },
    {
      title: '',
      key: 'actions',
      width: 90,
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="下载 Excel">
            <Button
              type="text"
              size="small"
              icon={<DownloadOutlined />}
              aria-label="下载 Excel"
              onClick={() =>
                void downloadSuiteExcel(key, r.id, r.name).catch((err: Error) =>
                  message.error(err.message),
                )
              }
            />
          </Tooltip>
          {canManage && (
            <Popconfirm
              title={`删除「${r.name}」？`}
              description="文件里的用例、测试结果和历史轮次都会删除。"
              okText="删除"
              okButtonProps={{ danger: true }}
              onConfirm={() => void remove(r)}
            >
              <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label="删除" />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <Typography.Title level={4}>{project.data?.name ?? key} · 自动化测试</Typography.Title>
        <div style={{ flex: 1 }} />
        <Tooltip title="刷新">
          <Button icon={<ReloadOutlined />} aria-label="刷新" onClick={refresh} />
        </Tooltip>
        {canManage && (
          <>
            <Button icon={<RobotOutlined />} onClick={() => setGenOpen(true)}>
              用 Claude 生成
            </Button>
            <Upload
              accept=".xlsx"
              showUploadList={false}
              beforeUpload={(file) => {
                void upload(file);
                return false;
              }}
            >
              <Button type="primary" icon={<UploadOutlined />} loading={uploading}>
                上传 Excel
              </Button>
            </Upload>
          </>
        )}
      </div>
      <Typography.Paragraph type="secondary">
        一份需求文档一个用例文件，打开后按 Excel 的样子查看和填写测试结果；也可以下载成 Excel。
      </Typography.Paragraph>
      <Table<TestSuiteItem>
        rowKey="id"
        size="middle"
        loading={suites.isFetching}
        columns={columns}
        dataSource={suites.data}
        pagination={{ pageSize: 50, hideOnSinglePage: true }}
        scroll={{ x: 1100 }}
      />
      <GenerateModal projectKey={key} open={genOpen} onClose={() => setGenOpen(false)} />
    </div>
  );
}

/** 用 Claude 生成：给出在 Claude Code 里要输入的命令 */
function GenerateModal({
  projectKey,
  open,
  onClose,
}: {
  projectKey: string;
  open: boolean;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const [source, setSource] = useState('');
  const command = `/mcp__defects__gen_test_cases ${projectKey} ${source.trim() || '<需求文档链接>'}`;
  return (
    <Modal title="用 Claude 生成用例文件" open={open} footer={null} width={640} onCancel={onClose}>
      <Typography.Paragraph>
        Claude
        会读完需求文档，按模块生成用例文件：概览、测试点汇总、需求待确认，以及每个模块一个工作表，
        格式与团队的 Excel
        用例表一致。能自动执行的标「自动」，需要看硬件、等定时任务等的标「人工」。
      </Typography.Paragraph>
      <ol style={{ paddingLeft: 18 }}>
        <li>
          先在「个人设置与 Claude Code 接入」里创建 Token，按页面命令把平台接入 Claude
          Code（已接入可跳过）。
        </li>
        <li>
          填入需求文档链接（Claude Docs 链接或本地文件路径）：
          <Input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="https://claude.ai/artifact/…"
            style={{ margin: '6px 0' }}
          />
        </li>
        <li>
          在新开的 Claude Code 会话里输入：
          <Space.Compact style={{ width: '100%', marginTop: 6 }}>
            <Input readOnly value={command} className="mono" />
            <Button
              icon={<CopyOutlined />}
              onClick={() =>
                void copyText(command).then((ok) =>
                  ok ? message.success('已复制') : message.error('复制失败，请手动选择复制'),
                )
              }
            >
              复制
            </Button>
          </Space.Compact>
        </li>
        <li>生成完回到本页刷新，打开文件查看。</li>
      </ol>
    </Modal>
  );
}
