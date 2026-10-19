import {
  PRIORITY_OPTIONS,
  RESOLUTION_OPTIONS,
  ROOT_CAUSE_OPTIONS,
  type WorkflowTransition,
} from '@defect/shared';
import { Form, Input, Modal, Select } from 'antd';
import { useEffect } from 'react';
import type { DefectDetail, ProjectDetail } from '../api/types';

export interface TransitionSubmit {
  transition: string;
  comment?: string;
  values: Record<string, unknown>;
}

/** 流转时补填工作流要求的字段与说明（方案 6.7 流转必填）。 */
export function TransitionModal({
  transition,
  defect,
  project,
  loading,
  onCancel,
  onSubmit,
}: {
  transition: WorkflowTransition | null;
  defect: DefectDetail;
  project: ProjectDetail;
  loading: boolean;
  onCancel: () => void;
  onSubmit: (v: TransitionSubmit) => void;
}) {
  const [form] = Form.useForm();
  useEffect(() => {
    if (transition) {
      form.setFieldsValue({
        priority: defect.priority ?? undefined,
        moduleId: defect.moduleId ?? undefined,
        resolution: defect.resolution ?? undefined,
        rootCause: defect.rootCause ?? undefined,
        comment: undefined,
      });
    }
  }, [transition, defect, form]);

  if (!transition) return null;
  const required = new Set(transition.requiredFields);
  const field = (name: string) => required.has(name);

  return (
    <Modal
      open
      title={`${transition.label}：${defect.code}`}
      okText={transition.label}
      confirmLoading={loading}
      onCancel={onCancel}
      onOk={() => form.submit()}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(v: Record<string, unknown>) => {
          const values: Record<string, unknown> = {};
          for (const k of ['priority', 'moduleId', 'resolution', 'rootCause'])
            if (v[k]) values[k] = v[k];
          onSubmit({
            transition: transition.key,
            comment: v.comment as string | undefined,
            values,
          });
        }}
      >
        {field('priority') && (
          <Form.Item name="priority" label="优先级" rules={[{ required: true }]}>
            <Select options={PRIORITY_OPTIONS} />
          </Form.Item>
        )}
        {field('moduleId') && (
          <Form.Item name="moduleId" label="模块" rules={[{ required: true }]}>
            <Select options={project.modules.map((m) => ({ value: m.id, label: m.name }))} />
          </Form.Item>
        )}
        {(field('resolution') || transition.to === 'resolved') && (
          <Form.Item name="resolution" label="解决方法" rules={[{ required: field('resolution') }]}>
            <Select allowClear options={RESOLUTION_OPTIONS} />
          </Form.Item>
        )}
        {transition.to === 'resolved' && (
          <Form.Item name="rootCause" label="缺陷根源">
            <Select allowClear options={ROOT_CAUSE_OPTIONS} />
          </Form.Item>
        )}
        <Form.Item
          name="comment"
          label="说明"
          rules={[{ required: !!transition.requiresComment, message: '该流转需要填写说明' }]}
        >
          <Input.TextArea
            rows={3}
            placeholder={transition.requiresComment ? '必填，会作为评论保存' : '选填'}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
