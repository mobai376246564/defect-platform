import { PlusOutlined } from '@ant-design/icons';
import { PROJECT_ROLE } from '@defect/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Skeleton,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { qk, useProjects } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';

export function ProjectsPage() {
  const { user } = useAuth();
  const { data, isLoading } = useProjects();
  const [open, setOpen] = useState(false);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0, flex: 1 }}>
          我的项目
        </Typography.Title>
        {user?.isSystemAdmin && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            新建项目
          </Button>
        )}
      </div>
      {isLoading ? (
        <Skeleton active />
      ) : !data?.length ? (
        <Empty description="你还没有加入任何项目，请联系管理员" />
      ) : (
        <Row gutter={[16, 16]}>
          {data.map((p) => (
            <Col key={p.id} xs={24} sm={12} lg={8}>
              <Link to={`/p/${p.key}/bugs`}>
                <Card hoverable title={p.name} extra={<Tag>{p.key}</Tag>}>
                  <Typography.Paragraph
                    type="secondary"
                    ellipsis={{ rows: 2 }}
                    style={{ minHeight: 44 }}
                  >
                    {p.description || '暂无描述'}
                  </Typography.Paragraph>
                  <div
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end' }}
                  >
                    <Statistic title="未关闭缺陷" value={p.openDefects} />
                    <Tag color="blue">{PROJECT_ROLE[p.role]}</Tag>
                  </div>
                </Card>
              </Link>
            </Col>
          ))}
        </Row>
      )}
      <CreateProjectModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function CreateProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: (v: { key: string; name: string; description?: string; appIds?: string[] }) =>
      api('/projects', { method: 'POST', body: v }),
    onSuccess: () => {
      message.success('项目已创建');
      void qc.invalidateQueries({ queryKey: qk.projects });
      form.resetFields();
      onClose();
    },
    onError: (e: Error) => message.error(e.message),
  });

  return (
    <Modal
      title="新建项目"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={create.isPending}
    >
      <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)}>
        <Form.Item
          name="key"
          label="项目标识"
          extra="缺陷编号前缀，如 APP → APP-1024；创建后不可修改"
          rules={[
            {
              required: true,
              pattern: /^[A-Z][A-Z0-9]{1,9}$/,
              message: '2–10 位大写字母或数字，以字母开头',
            },
          ]}
        >
          <Input placeholder="APP" />
        </Form.Item>
        <Form.Item name="name" label="项目名称" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item name="appIds" label="绑定的 APP 包名" extra="APP 反馈按包名自动建单到本项目">
          <Select mode="tags" placeholder="com.example.app" open={false} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
