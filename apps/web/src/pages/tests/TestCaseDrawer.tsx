import {
  TEST_CASE_MODE_OPTIONS,
  TEST_CASE_ORIGIN,
  TEST_CASE_STATUS_OPTIONS,
  TEST_PRIORITIES,
} from '@defect/shared';
import { useQueryClient } from '@tanstack/react-query';
import { App, AutoComplete, Button, Col, Drawer, Form, Input, Row, Select, Space, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { qk } from '../../api/hooks';
import type { TestCaseItem, TestCaseModule } from '../../api/types';

/** 表单里步骤 / 预期按“一行一条”编辑，提交时拆成数组 */
interface FormValues {
  title: string;
  module: string;
  priority: string;
  precondition: string;
  steps: string;
  expected: string;
  testData: string;
  mode: 'auto' | 'manual';
  manualReason: string;
  env: string;
  source: string;
  status: string;
}

const toLines = (v: string) =>
  v
    .split('\n')
    .map((l) => l.replace(/^\s*\d+[.、)]\s*/, '').trim())
    .filter(Boolean);

const EMPTY: FormValues = {
  title: '',
  module: '',
  priority: 'P2',
  precondition: '',
  steps: '',
  expected: '',
  testData: '',
  mode: 'auto',
  manualReason: '',
  env: '',
  source: '',
  status: 'draft',
};

/**
 * 新建 / 编辑测试用例的抽屉。value 为 null 时新建；canEdit 为 false 时只读查看。
 */
export function TestCaseDrawer({
  projectKey,
  value,
  open,
  canEdit,
  modules,
  onClose,
}: {
  projectKey: string;
  value: TestCaseItem | null;
  open: boolean;
  canEdit: boolean;
  modules: TestCaseModule[];
  onClose: () => void;
}) {
  const [form] = Form.useForm<FormValues>();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const mode = Form.useWatch('mode', form);

  // 打开时把用例填进表单（数组按行展开）
  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(
      value
        ? {
            ...value,
            steps: value.steps.join('\n'),
            expected: value.expected.join('\n'),
          }
        : EMPTY,
    );
  }, [open, value, form]);

  const onFinish = async (v: FormValues) => {
    setSaving(true);
    try {
      const body = { ...v, steps: toLines(v.steps), expected: toLines(v.expected) };
      if (value) {
        await api(`/projects/${projectKey}/tests/cases/${value.id}`, { method: 'PATCH', body });
        message.success(`已保存 ${value.code}`);
      } else {
        const created = await api<TestCaseItem>(`/projects/${projectKey}/tests/cases`, {
          method: 'POST',
          body,
        });
        message.success(`已新建 ${created.code}`);
      }
      void qc.invalidateQueries({ queryKey: qk.tests(projectKey) });
      onClose();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      title={
        value ? (
          <Space>
            <span className="mono">{value.code}</span>
            <Tag bordered={false}>{TEST_CASE_ORIGIN[value.origin]}</Tag>
          </Space>
        ) : (
          '新建用例'
        )
      }
      open={open}
      width={640}
      onClose={onClose}
      destroyOnHidden={false}
      extra={
        canEdit && (
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" loading={saving} onClick={() => form.submit()}>
              保存
            </Button>
          </Space>
        )
      }
    >
      <Form<FormValues>
        form={form}
        layout="vertical"
        requiredMark="optional"
        disabled={!canEdit}
        onFinish={onFinish}
      >
        <Form.Item name="title" label="标题" rules={[{ required: true, whitespace: true }]}>
          <Input maxLength={200} />
        </Form.Item>
        <Row gutter={12}>
          <Col span={10}>
            <Form.Item name="module" label="模块">
              <AutoComplete
                options={modules.map((m) => ({ value: m.module }))}
                filterOption={(input, opt) => (opt?.value ?? '').includes(input)}
                maxLength={60}
              />
            </Form.Item>
          </Col>
          <Col span={7}>
            <Form.Item name="priority" label="优先级">
              <Select options={TEST_PRIORITIES.map((p) => ({ value: p, label: p }))} />
            </Form.Item>
          </Col>
          <Col span={7}>
            <Form.Item name="status" label="状态">
              <Select options={TEST_CASE_STATUS_OPTIONS} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="precondition" label="前置条件">
          <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} />
        </Form.Item>
        <Form.Item
          name="steps"
          label="步骤"
          tooltip="一行一步"
          rules={[{ required: true, whitespace: true, message: '至少一个步骤' }]}
        >
          <Input.TextArea autoSize={{ minRows: 3, maxRows: 12 }} />
        </Form.Item>
        <Form.Item
          name="expected"
          label="预期结果"
          tooltip="一行一条"
          rules={[{ required: true, whitespace: true, message: '至少一条预期结果' }]}
        >
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 10 }} />
        </Form.Item>
        <Form.Item
          name="testData"
          label="测试数据"
          tooltip="边界值等，AI 和人工执行都按这里的数据测"
        >
          <Input.TextArea autoSize={{ minRows: 1, maxRows: 6 }} />
        </Form.Item>
        <Row gutter={12}>
          <Col span={8}>
            <Form.Item name="mode" label="执行方式">
              <Select options={TEST_CASE_MODE_OPTIONS} />
            </Form.Item>
          </Col>
          <Col span={16}>
            <Form.Item name="env" label="适用环境">
              <Input placeholder="如：编辑器、真机" maxLength={100} />
            </Form.Item>
          </Col>
        </Row>
        {mode === 'manual' && (
          <Form.Item name="manualReason" label="人工执行原因">
            <Input placeholder="如：需要看 BOX 硬件屏幕" maxLength={500} />
          </Form.Item>
        )}
        <Form.Item name="source" label="来源">
          <Input placeholder="需求文档链接与章节" maxLength={500} />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
