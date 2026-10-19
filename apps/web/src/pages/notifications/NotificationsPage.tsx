import { NOTIFICATION_KIND } from '@defect/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Badge, Button, List, Segmented, Space, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { qk, useNotifications } from '../../api/hooks';
import type { NotificationItem } from '../../api/types';
import { notificationLink, notificationTime } from './notifications';

const KIND_COLOR: Record<NotificationItem['kind'], string> = {
  assigned: 'blue',
  mentioned: 'purple',
  status_changed: 'cyan',
};

/** 通知中心（方案 6.4）：指派、@、状态变更；点击跳转到缺陷并标记已读。 */
export function NotificationsPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [unread, setUnread] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const list = useNotifications({ unread, page, pageSize });
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.notifications });

  const markRead = useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: refresh,
  });
  const markAll = useMutation({
    mutationFn: () => api<{ updated: number }>('/notifications/read-all', { method: 'POST' }),
    onSuccess: (r) => {
      message.success(r.updated ? `已将 ${r.updated} 条标为已读` : '没有未读通知');
      refresh();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const open = (n: NotificationItem) => {
    if (!n.readAt) markRead.mutate(n.id);
    const link = notificationLink(n);
    if (link) navigate(link);
  };

  return (
    <div style={{ maxWidth: 900 }}>
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
          通知中心
        </Typography.Title>
        <div style={{ flex: 1 }} />
        <Segmented
          value={unread ? 'unread' : 'all'}
          options={[
            { value: 'all', label: '全部' },
            { value: 'unread', label: `未读${list.data ? `（${list.data.unread}）` : ''}` },
          ]}
          onChange={(v) => {
            setUnread(v === 'unread');
            setPage(1);
          }}
        />
        <Button
          onClick={() => markAll.mutate()}
          loading={markAll.isPending}
          disabled={!list.data?.unread}
        >
          全部标为已读
        </Button>
      </div>

      <List<NotificationItem>
        bordered
        loading={list.isFetching}
        dataSource={list.data?.items ?? []}
        locale={{
          emptyText: list.isError ? list.error.message : unread ? '没有未读通知' : '暂无通知',
        }}
        style={{ background: '#fff' }}
        pagination={
          (list.data?.total ?? 0) > pageSize
            ? {
                current: page,
                pageSize,
                total: list.data?.total ?? 0,
                onChange: setPage,
                showTotal: (t) => `共 ${t} 条`,
              }
            : false
        }
        renderItem={(n) => (
          <List.Item
            onClick={() => open(n)}
            style={{ cursor: 'pointer', background: n.readAt ? undefined : '#f0f7ff' }}
            actions={
              n.readAt
                ? []
                : [
                    <Button
                      key="read"
                      type="link"
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        markRead.mutate(n.id);
                      }}
                    >
                      标为已读
                    </Button>,
                  ]
            }
          >
            <List.Item.Meta
              title={
                <Space size={6} wrap>
                  {!n.readAt && <Badge status="processing" />}
                  <Tag color={KIND_COLOR[n.kind]}>{NOTIFICATION_KIND[n.kind] ?? n.kind}</Tag>
                  <Typography.Text strong={!n.readAt}>{n.title}</Typography.Text>
                </Space>
              }
              description={
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  <Typography.Text ellipsis style={{ maxWidth: 640 }}>
                    {n.body}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {n.projectName ?? n.projectKey ?? '已删除的项目'} ·{' '}
                    {notificationTime(n.createdAt)}
                  </Typography.Text>
                </Space>
              }
            />
          </List.Item>
        )}
      />
    </div>
  );
}
