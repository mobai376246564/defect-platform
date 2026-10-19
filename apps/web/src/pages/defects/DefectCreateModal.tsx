import {
  BUG_TYPE_OPTIONS,
  FREQUENCY_OPTIONS,
  PRIORITY_OPTIONS,
  SEVERITY_OPTIONS,
} from '@defect/shared';
import { useQueryClient } from '@tanstack/react-query';
import { App, Col, Collapse, Form, Input, Modal, Row, Select } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import type { DefectRow, ProjectDetail } from '../../api/types';
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

/** 在缺陷列表里直接提单：常用字段在前，期望 / 实际结果等放在“更多信息”里 */
export function DefectCreateModal({
  projectKey,
  project,
  open,
  onClose,
}: {
  projectKey: string;
  project: ProjectDetail | undefined;
  open: boolean;
  onClose: () => void;
}) {
  const [form] = Form.useForm<FormValues>();
  const { message, notification } = App.useApp();
  const qc = useQueryClient();
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const done = (created: DefectRow, warning?: string) => {
    void qc.invalidateQueries({ queryKey: ['defects', projectKey] });
    const link = (
      <Link to={`/p/${projectKey}/bugs/${created.code}`} onClick={() => notification.destroy()}>
        查看 {created.code}
      </Link>
    );
    if (warning) notification.warning({ message: warning, description: link });
    else notification.success({ message: `已创建 ${created.code}`, description: link });
    form.resetFields();
    setFiles([]);
    onClose();
  };

  const onFinish = async (values: FormValues) => {
    setSubmitting(true);
    let created: DefectRow | null = null;
    try {
      created = await api<DefectRow>(`/projects/${projectKey}/defects`, {
        method: 'POST',
        body: values,
      });
      if (files.length) {
        setProgress(`上传附件 0/${files.length}`);
        await uploadAttachments(projectKey, created.code, files, (d, t) =>
          setProgress(`上传附件 ${d}/${t}`),
        );
      }
      done(created);
    } catch (err) {
      // 缺陷已建成但附件失败时不再重复建单，提示到详情页补传
      if (created) done(created, `${created.code} 已创建，附件上传失败：${(err as Error).message}`);
      else message.error((err as Error).message);
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  };

  const options = {
    modules: project?.modules.map((m) => ({ value: m.id, label: m.name })),
    members: project?.members.map((m) => ({ value: m.id, label: m.name })),
    versions: project?.versions.map((v) => ({
      value: v.id,
      label: v.commit ? `${v.name}（${v.commit.slice(0, 7)}）` : v.name,
    })),
  };

  return (
    <Modal
      title="新建缺陷"
      open={open}
      width={720}
      okText={progress ?? '提交'}
      cancelText="取消"
      confirmLoading={submitting}
      onOk={() => form.submit()}
      onCancel={() => !submitting && onClose()}
      maskClosable={false}
      destroyOnHidden={false}
      styles={{
        body: {
          maxHeight: 'calc(100vh - 220px)',
          overflowY: 'auto',
          overflowX: 'hidden',
          paddingRight: 4,
        },
      }}
    >
      <Form<FormValues>
        form={form}
        layout="vertical"
        requiredMark="optional"
        onFinish={onFinish}
        initialValues={{ severity: 'normal', frequency: 'always' }}
      >
        <Form.Item
          name="title"
          label="标题"
          rules={[{ required: true, max: 120, message: '请填写标题（最多 120 字）' }]}
        >
          <Input autoFocus placeholder="一句话描述问题，如：支付成功后订单页仍显示待支付" />
        </Form.Item>
        <Row gutter={12}>
          <Col xs={12} sm={8}>
            <Form.Item name="severity" label="严重程度" rules={[{ required: true }]}>
              <Select options={SEVERITY_OPTIONS} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={8}>
            <Form.Item name="priority" label="优先级">
              <Select allowClear options={PRIORITY_OPTIONS} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="moduleId" label="模块" tooltip="选择模块后自动指派给模块负责人">
              <Select allowClear options={options.modules} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item
          name="steps"
          label="复现步骤"
          rules={[{ required: true, message: '请填写复现步骤' }]}
        >
          <Input.TextArea
            autoSize={{ minRows: 3, maxRows: 8 }}
            placeholder={'1. 打开订单页\n2. 点击支付\n3. 支付成功后返回'}
          />
        </Form.Item>
        <Form.Item label="附件" style={{ marginBottom: 12 }}>
          <AttachmentPicker value={files} onChange={setFiles} />
        </Form.Item>
        <Collapse
          ghost
          size="small"
          items={[
            {
              key: 'more',
              label: '更多信息（处理人、版本、期望与实际结果）',
              forceRender: true,
              children: (
                <>
                  <Row gutter={12}>
                    <Col xs={24} sm={12}>
                      <Form.Item name="ownerIds" label="处理人">
                        <Select
                          mode="multiple"
                          allowClear
                          optionFilterProp="label"
                          options={options.members}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item name="versionFoundId" label="发现版本">
                        <Select allowClear options={options.versions} />
                      </Form.Item>
                    </Col>
                    <Col xs={12}>
                      <Form.Item name="frequency" label="重现规律">
                        <Select allowClear options={FREQUENCY_OPTIONS} />
                      </Form.Item>
                    </Col>
                    <Col xs={12}>
                      <Form.Item name="bugType" label="缺陷类型">
                        <Select allowClear options={BUG_TYPE_OPTIONS} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item name="expected" label="期望结果">
                        <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item name="actual" label="实际结果">
                        <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item name="description" label="补充说明" style={{ marginBottom: 0 }}>
                    <Input.TextArea
                      autoSize={{ minRows: 2, maxRows: 6 }}
                      placeholder="环境、账号、出现频率等"
                    />
                  </Form.Item>
                </>
              ),
            },
          ]}
        />
      </Form>
    </Modal>
  );
}
