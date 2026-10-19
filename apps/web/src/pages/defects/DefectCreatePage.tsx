import {
  BUG_TYPE_OPTIONS,
  FREQUENCY_OPTIONS,
  PRIORITY_OPTIONS,
  SEVERITY_OPTIONS,
} from '@defect/shared';
import { useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Col, Form, Input, Row, Select, Space, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useProject } from '../../api/hooks';
import type { DefectRow } from '../../api/types';
import { uploadAttachments, type PendingFile } from '../../api/upload';
import { AttachmentPicker } from '../../components/AttachmentPicker';

interface FormValues {
  title: string;
  severity: string;
  priority?: string;
  frequency?: string;
  bugType?: string;
  moduleId?: string;
  ownerIds?: string[];
  versionFoundId?: string;
  steps?: string;
  expected?: string;
  actual?: string;
  description?: string;
}

export function DefectCreatePage() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { data: project } = useProject(key);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const onFinish = async (values: FormValues) => {
    setSubmitting(true);
    let created: DefectRow | null = null;
    try {
      created = await api<DefectRow>(`/projects/${key}/defects`, { method: 'POST', body: values });
      if (files.length) {
        setProgress(`正在上传附件 0/${files.length}`);
        await uploadAttachments(key, created.code, files, (d, t) =>
          setProgress(`正在上传附件 ${d}/${t}`),
        );
      }
      message.success(`已创建 ${created.code}`);
      void qc.invalidateQueries({ queryKey: ['defects', key] });
      navigate(`/p/${key}/bugs/${created.code}`);
    } catch (err) {
      // 缺陷已建成但附件失败时，跳到详情页让用户补传，避免重复建单
      if (created) {
        message.warning(
          `${created.code} 已创建，但附件上传失败：${(err as Error).message}，可在详情页重新上传`,
        );
        navigate(`/p/${key}/bugs/${created.code}`);
      } else {
        message.error((err as Error).message);
      }
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <Typography.Title level={4}>新建缺陷</Typography.Title>
      <Form<FormValues>
        layout="vertical"
        onFinish={onFinish}
        initialValues={{ severity: 'normal', frequency: 'always' }}
      >
        <Card style={{ marginBottom: 16 }}>
          <Form.Item
            name="title"
            label="标题"
            rules={[{ required: true, max: 120, message: '请填写标题（最多 120 字）' }]}
          >
            <Input placeholder="一句话描述问题，如：支付成功后订单页仍显示待支付" />
          </Form.Item>
          <Row gutter={16}>
            <Col xs={24} sm={12} md={6}>
              <Form.Item name="severity" label="严重程度" rules={[{ required: true }]}>
                <Select options={SEVERITY_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Form.Item name="priority" label="优先级">
                <Select allowClear options={PRIORITY_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Form.Item name="frequency" label="重现规律">
                <Select allowClear options={FREQUENCY_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Form.Item name="bugType" label="缺陷类型">
                <Select allowClear options={BUG_TYPE_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item name="moduleId" label="模块" extra="选择模块后自动指派给模块负责人">
                <Select
                  allowClear
                  options={project?.modules.map((m) => ({ value: m.id, label: m.name }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item name="ownerIds" label="处理人">
                <Select
                  mode="multiple"
                  allowClear
                  optionFilterProp="label"
                  options={project?.members.map((m) => ({ value: m.id, label: m.name }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Form.Item
                name="versionFoundId"
                label="发现版本"
                extra="用于让 Claude 对照对应代码版本"
              >
                <Select
                  allowClear
                  options={project?.versions.map((v) => ({
                    value: v.id,
                    label: v.commit ? `${v.name}（${v.commit.slice(0, 7)}）` : v.name,
                  }))}
                />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Card title="问题描述" style={{ marginBottom: 16 }}>
          <Form.Item
            name="steps"
            label="复现步骤"
            rules={[{ required: true, message: '请填写复现步骤' }]}
          >
            <Input.TextArea
              rows={4}
              placeholder={'1. 打开订单页\n2. 点击支付\n3. 支付成功后返回'}
            />
          </Form.Item>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="expected" label="期望结果">
                <Input.TextArea rows={3} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="actual" label="实际结果">
                <Input.TextArea rows={3} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="补充说明">
            <Input.TextArea rows={3} placeholder="环境、账号、出现频率等" />
          </Form.Item>
        </Card>

        <Card title="附件" style={{ marginBottom: 16 }}>
          <AttachmentPicker value={files} onChange={setFiles} />
        </Card>

        <Space>
          <Button type="primary" htmlType="submit" loading={submitting}>
            {progress ?? '提交'}
          </Button>
          <Button onClick={() => navigate(-1)} disabled={submitting}>
            取消
          </Button>
        </Space>
      </Form>
    </div>
  );
}
