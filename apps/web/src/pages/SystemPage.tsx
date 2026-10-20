import { CloudDownloadOutlined, ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Collapse,
  Descriptions,
  Empty,
  List,
  Popconfirm,
  Result,
  Space,
  Spin,
  Steps,
  Tag,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import { Navigate } from 'react-router-dom';
import { api } from '../api/client';
import { qk, useSystemVersion, useUpdateStatus } from '../api/hooks';
import type { SystemVersion, UpdateStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';

/** 与 deploy/pm2/self-update.sh 的步骤一一对应 */
const STEPS = [
  { key: 'fetch', title: '拉取代码' },
  { key: 'backup', title: '备份数据库' },
  { key: 'merge', title: '合并' },
  { key: 'deps', title: '安装依赖' },
  { key: 'build', title: '构建' },
  { key: 'migrate', title: '数据库迁移' },
  { key: 'restart', title: '重启服务' },
  { key: 'verify', title: '健康检查' },
];

const time = (v: string | null | undefined) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '—');

/** 系统更新（仅系统管理员）：查看当前版本、检查新版本、一键在线更新并查看进度 */
export function SystemPage() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const version = useSystemVersion();
  const isAdmin = !!user?.isSystemAdmin;
  const status = useUpdateStatus(isAdmin, true);
  const running = status.data?.state === 'running';
  // 服务重启期间接口暂时不可用：保持轮询，不当作失败
  const restarting = running && status.isError;

  const check = useMutation({
    mutationFn: () => api<SystemVersion>('/system/version/check', { method: 'POST' }),
    onSuccess: (v) => {
      qc.setQueryData(qk.systemVersion, v);
      message.success(v.behind ? `发现 ${v.behind} 项更新` : '已是最新版本');
    },
    onError: (e: Error) => message.error(e.message),
  });
  const start = useMutation({
    mutationFn: () => api<UpdateStatus>('/system/update', { method: 'POST' }),
    onSuccess: (s) => qc.setQueryData(qk.updateStatus, s),
    onError: (e: Error) => message.error(e.message),
  });

  if (!isAdmin) return <Navigate to="/projects" replace />;
  if (version.isLoading) return <Spin style={{ display: 'block', margin: '64px auto' }} />;
  const v = version.data;
  const s = status.data;
  const finished = s?.state === 'succeeded' && v?.current?.commit === s.to;

  return (
    <div className="page-narrow">
      <div className="page-header">
        <Typography.Title level={4}>系统更新</Typography.Title>
      </div>

      {v && !v.selfUpdate.enabled && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="在线更新未开启"
          description={`${v.selfUpdate.reason ?? ''}。开启方法见部署文档 docs/deploy-single-host.md 的“在线更新”一节。`}
        />
      )}

      <div className="card-grid">
        <Card title="当前版本">
          <Descriptions column={1} size="small">
            <Descriptions.Item label="提交">
              <Typography.Text className="mono" copyable={{ text: v?.current?.commit }}>
                {v?.current?.shortCommit ?? '未知'}
              </Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="说明">{v?.current?.subject ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="提交时间">{time(v?.current?.committedAt)}</Descriptions.Item>
            <Descriptions.Item label="更新来源">
              <span className="mono">
                {v?.selfUpdate.remote}/{v?.selfUpdate.branch}
              </span>
            </Descriptions.Item>
          </Descriptions>
        </Card>

        <Card
          title="新版本"
          extra={
            <Button
              size="small"
              icon={<SyncOutlined />}
              loading={check.isPending}
              disabled={!v?.selfUpdate.enabled || running}
              onClick={() => check.mutate()}
            >
              检查更新
            </Button>
          }
        >
          <Space direction="vertical" style={{ width: '100%' }}>
            <Typography.Text type="secondary">上次检查：{time(v?.checkedAt)}</Typography.Text>
            {v?.checkError && <Alert type="error" showIcon message={v.checkError} />}
            {v && v.behind > 0 ? (
              <>
                <Typography.Text>
                  有 <Typography.Text strong>{v.behind}</Typography.Text> 项更新：
                </Typography.Text>
                <List
                  size="small"
                  bordered
                  style={{ maxHeight: 240, overflow: 'auto' }}
                  dataSource={v.commits}
                  renderItem={(c) => (
                    <List.Item>
                      <Space size={8} style={{ minWidth: 0 }}>
                        <Typography.Text className="mono" type="secondary">
                          {c.shortCommit}
                        </Typography.Text>
                        <Typography.Text ellipsis={{ tooltip: c.subject }}>
                          {c.subject}
                        </Typography.Text>
                      </Space>
                    </List.Item>
                  )}
                />
                <Popconfirm
                  title="开始更新？"
                  description="更新时会先备份数据库，服务重启期间约 1–3 分钟无法访问。"
                  okText="开始更新"
                  onConfirm={() => start.mutate()}
                  disabled={running}
                >
                  <Button
                    type="primary"
                    icon={<CloudDownloadOutlined />}
                    loading={start.isPending}
                    disabled={running}
                  >
                    立即更新
                  </Button>
                </Popconfirm>
              </>
            ) : (
              v?.checkedAt &&
              !v.checkError && (
                <Empty description="已是最新版本" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )
            )}
          </Space>
        </Card>

        {s && s.state !== 'idle' && (
          <Card title="更新进度" className="span-2">
            {finished ? (
              <Result
                status="success"
                title={`已更新到 ${s.to.slice(0, 7)}`}
                subTitle={s.backup ? `更新前的数据库备份：${s.backup}` : undefined}
                extra={
                  __APP_COMMIT__ !== s.to && (
                    <Button
                      type="primary"
                      icon={<ReloadOutlined />}
                      onClick={() => window.location.reload()}
                    >
                      刷新页面使用新版本
                    </Button>
                  )
                }
              />
            ) : (
              <UpdateProgress status={s} restarting={restarting} />
            )}
            <Collapse
              ghost
              size="small"
              defaultActiveKey={s.state === 'failed' ? ['log'] : []}
              items={[
                {
                  key: 'log',
                  label: '更新日志',
                  children: (
                    <pre
                      style={{
                        maxHeight: 360,
                        overflow: 'auto',
                        margin: 0,
                        padding: 12,
                        fontSize: 12,
                        fontFamily: 'var(--mono)',
                        background: 'var(--code-bg)',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {s.log || '（暂无日志）'}
                    </pre>
                  ),
                },
              ]}
            />
          </Card>
        )}
      </div>
    </div>
  );
}

function UpdateProgress({ status: s, restarting }: { status: UpdateStatus; restarting: boolean }) {
  const index = Math.max(
    0,
    STEPS.findIndex((x) => x.key === s.step),
  );
  const stepStatus = s.state === 'failed' ? 'error' : s.state === 'running' ? 'process' : 'finish';
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Steps
        size="small"
        current={s.step === 'done' ? STEPS.length : index}
        status={stepStatus}
        items={STEPS.map((x) => ({ title: x.title }))}
        responsive
      />
      <Space wrap>
        {s.state === 'running' && <Tag color="processing">进行中</Tag>}
        {s.state === 'failed' && <Tag color="error">失败</Tag>}
        {s.state === 'succeeded' && <Tag color="success">完成</Tag>}
        <Typography.Text>
          {restarting ? '服务重启中，稍候自动刷新进度…' : s.message}
        </Typography.Text>
      </Space>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        <span className="mono">
          {s.from.slice(0, 7)} → {s.to.slice(0, 7) || '?'}
        </span>
        ，开始于 {time(s.startedAt)}
        {s.backup ? `，数据库备份：${s.backup}` : ''}
      </Typography.Text>
    </Space>
  );
}
