import {
  DeleteOutlined,
  EditOutlined,
  MoreOutlined,
  PlusOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { PROJECT_ROLE } from '@defect/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Skeleton,
  Space,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { qk, useProjects } from '../api/hooks';
import type { ProjectSummary } from '../api/types';
import { useAuth } from '../auth/AuthContext';

/** 项目列表；系统管理员在这里新建、编辑、删除项目 */
export function ProjectsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading } = useProjects();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const isAdmin = !!user?.isSystemAdmin;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 8 }}>
        <Typography.Title level={4} style={{ margin: 0, flex: 1 }}>
          {isAdmin ? '项目管理' : '我的项目'}
        </Typography.Title>
        {isAdmin && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            新建项目
          </Button>
        )}
      </div>
      {isLoading ? (
        <Skeleton active />
      ) : !data?.length ? (
        <Empty
          description={isAdmin ? '还没有项目，先新建一个' : '你还没有加入任何项目，请联系管理员'}
        />
      ) : (
        <Row gutter={[16, 16]}>
          {data.map((p) => (
            <Col key={p.id} xs={24} sm={12} xl={8} xxl={6}>
              <Card
                hoverable
                onClick={() => navigate(`/p/${p.key}/bugs`)}
                title={
                  <Space>
                    <span>{p.name}</span>
                    <Tag bordered={false}>{p.key}</Tag>
                  </Space>
                }
                extra={
                  isAdmin && (
                    <Dropdown
                      trigger={['click']}
                      menu={{
                        items: [
                          { key: 'edit', icon: <EditOutlined />, label: '编辑' },
                          { key: 'delete', icon: <DeleteOutlined />, label: '删除', danger: true },
                        ],
                        onClick: ({ key, domEvent }) => {
                          domEvent.stopPropagation();
                          if (key === 'edit') setEditing(p);
                          else setDeleting(p);
                        },
                      }}
                    >
                      <Button
                        type="text"
                        size="small"
                        icon={<MoreOutlined />}
                        aria-label="项目操作"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Dropdown>
                  )
                }
              >
                <Typography.Paragraph
                  type="secondary"
                  ellipsis={{ rows: 2 }}
                  style={{ minHeight: 44 }}
                >
                  {p.description || '暂无描述'}
                </Typography.Paragraph>
                <Row gutter={8} align="bottom">
                  <Col span={8}>
                    <Statistic title="未关闭" value={p.openDefects} />
                  </Col>
                  <Col span={8}>
                    <Statistic title="缺陷总数" value={p.totalDefects} />
                  </Col>
                  <Col span={8} style={{ textAlign: 'right' }}>
                    <Space direction="vertical" size={4} align="end">
                      <Typography.Text type="secondary">
                        <TeamOutlined /> {p.memberCount}
                      </Typography.Text>
                      {p.role && <Tag color="blue">{PROJECT_ROLE[p.role]}</Tag>}
                    </Space>
                  </Col>
                </Row>
              </Card>
            </Col>
          ))}
        </Row>
      )}
      <ProjectFormModal open={creating} onClose={() => setCreating(false)} />
      <ProjectFormModal
        open={!!editing}
        project={editing ?? undefined}
        onClose={() => setEditing(null)}
      />
      <DeleteProjectModal project={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

interface ProjectForm {
  key: string;
  name: string;
  description?: string;
  appIds?: string[];
}

/** 新建（不传 project）或编辑项目；项目标识创建后不可修改 */
function ProjectFormModal({
  open,
  project,
  onClose,
}: {
  open: boolean;
  project?: ProjectSummary;
  onClose: () => void;
}) {
  const [form] = Form.useForm<ProjectForm>();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const editing = !!project;
  const save = useMutation({
    mutationFn: (v: ProjectForm) =>
      project
        ? api(`/projects/${project.key}`, {
            method: 'PATCH',
            body: { name: v.name, description: v.description ?? '', appIds: v.appIds ?? [] },
          })
        : api('/projects', { method: 'POST', body: v }),
    onSuccess: () => {
      message.success(editing ? '已保存' : '项目已创建');
      void qc.invalidateQueries({ queryKey: qk.projects });
      if (project) void qc.invalidateQueries({ queryKey: qk.project(project.key) });
      onClose();
    },
    onError: (e: Error) => message.error(e.message),
  });

  return (
    <Modal
      title={project ? `编辑项目 · ${project.key}` : '新建项目'}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={save.isPending}
      destroyOnHidden
      afterOpenChange={(visible) => {
        if (visible) form.setFieldsValue(project ?? { key: '', name: '', appIds: [] });
      }}
    >
      <Form form={form} layout="vertical" preserve={false} onFinish={(v) => save.mutate(v)}>
        {!editing && (
          <Form.Item
            name="key"
            label="项目标识"
            extra="缺陷编号前缀，如 APP → APP-1024；创建后不可修改"
            normalize={(v?: string) => v?.toUpperCase()}
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
        )}
        <Form.Item name="name" label="项目名称" rules={[{ required: true, max: 50 }]}>
          <Input />
        </Form.Item>
        <Form.Item name="description" label="描述" rules={[{ max: 500 }]}>
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item
          name="appIds"
          label="绑定的 APP 包名"
          extra="APP 反馈按包名自动建单到本项目，输入后回车"
        >
          <Select mode="tags" placeholder="com.example.app" open={false} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** 删除项目：需要输入项目标识确认 */
function DeleteProjectModal({
  project,
  onClose,
}: {
  project: ProjectSummary | null;
  onClose: () => void;
}) {
  const [confirm, setConfirm] = useState('');
  const { message } = App.useApp();
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (key: string) =>
      api(`/projects/${key}`, { method: 'DELETE', query: { confirm: key } }),
    onSuccess: () => {
      message.success('项目已删除');
      void qc.invalidateQueries({ queryKey: qk.projects });
      onClose();
    },
    onError: (e: Error) => message.error(e.message),
  });

  return (
    <Modal
      title={project ? `删除项目 · ${project.name}` : ''}
      open={!!project}
      onCancel={onClose}
      afterOpenChange={(visible) => !visible && setConfirm('')}
      okText="永久删除"
      okButtonProps={{ danger: true, disabled: confirm !== project?.key }}
      confirmLoading={remove.isPending}
      onOk={() => project && remove.mutate(project.key)}
    >
      {project && (
        <>
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message="删除后无法恢复"
            description={`项目下的 ${project.totalDefects} 个缺陷及其评论、附件记录、变更历史、成员与视图会一并删除。`}
          />
          <Typography.Paragraph>
            请输入项目标识 <Typography.Text code>{project.key}</Typography.Text> 确认：
          </Typography.Paragraph>
          <Input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value.trim().toUpperCase())}
            placeholder={project.key}
          />
        </>
      )}
    </Modal>
  );
}
