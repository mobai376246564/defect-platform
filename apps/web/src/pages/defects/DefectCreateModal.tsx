import {
  BUG_TYPE_OPTIONS,
  FREQUENCY_OPTIONS,
  PRIORITY_OPTIONS,
  SEVERITY_OPTIONS,
  isFieldVisible,
  type DetailField,
} from '@defect/shared';
import { useQueryClient } from '@tanstack/react-query';
import { App, Col, Collapse, Form, Input, Modal, Row, Select } from 'antd';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
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

/** “更多信息”折叠区里的一个字段 */
interface MoreField {
  label: string;
  node: ReactNode;
}

/** 在缺陷列表里直接提单：常用字段在前，期望 / 实际结果等放在“更多信息”里（默认展开） */
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
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const done = (created: DefectRow, warning?: string) => {
    void qc.invalidateQueries({ queryKey: ['defects', projectKey] });
    // 提示框渲染在路由之外，不能放 <Link>（会因拿不到路由上下文整页崩掉）；用普通链接 + 这里的 navigate 跳转
    const href = `/p/${projectKey}/bugs/${created.code}`;
    const link = (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          notification.destroy();
          void navigate(href);
        }}
      >
        查看 {created.code}
      </a>
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
  // 只显示项目设置里开启的字段
  const show = (f: DetailField) => isFieldVisible(project?.hiddenFields, f);
  const candidates: (MoreField | false)[] = [
    show('ownerIds') && {
      label: '处理人',
      node: (
        <Col key="ownerIds" xs={24} sm={12}>
          <Form.Item name="ownerIds" label="处理人">
            <Select mode="multiple" allowClear optionFilterProp="label" options={options.members} />
          </Form.Item>
        </Col>
      ),
    },
    show('versionFoundId') && {
      label: '发现版本',
      node: (
        <Col key="versionFoundId" xs={24} sm={12}>
          <Form.Item name="versionFoundId" label="发现版本">
            <Select allowClear options={options.versions} />
          </Form.Item>
        </Col>
      ),
    },
    show('frequency') && {
      label: '重现规律',
      node: (
        <Col key="frequency" xs={12}>
          <Form.Item name="frequency" label="重现规律">
            <Select allowClear options={FREQUENCY_OPTIONS} />
          </Form.Item>
        </Col>
      ),
    },
    show('bugType') && {
      label: '缺陷类型',
      node: (
        <Col key="bugType" xs={12}>
          <Form.Item name="bugType" label="缺陷类型">
            <Select allowClear options={BUG_TYPE_OPTIONS} />
          </Form.Item>
        </Col>
      ),
    },
    show('expected') && {
      label: '期望结果',
      node: (
        <Col key="expected" xs={24} sm={12}>
          <Form.Item name="expected" label="期望结果">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
          </Form.Item>
        </Col>
      ),
    },
    show('actual') && {
      label: '实际结果',
      node: (
        <Col key="actual" xs={24} sm={12}>
          <Form.Item name="actual" label="实际结果">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
          </Form.Item>
        </Col>
      ),
    },
    show('description') && {
      label: '补充说明',
      node: (
        <Col key="description" xs={24}>
          <Form.Item name="description" label="补充说明">
            <Input.TextArea
              autoSize={{ minRows: 2, maxRows: 6 }}
              placeholder="环境、账号、出现频率等"
            />
          </Form.Item>
        </Col>
      ),
    },
  ];
  const more = candidates.filter((m): m is MoreField => !!m);

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
      // 靠上显示，高度随全部展开后的内容，不在正文里出滚动条；屏幕放不下时整个弹窗随页面滚动
      style={{ top: 24, paddingBottom: 24 }}
    >
      <Form<FormValues>
        className="defect-create-form"
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
          {/* 严重程度必填：隐藏时用默认值“一般” */}
          <Col xs={12} sm={8} hidden={!show('severity')}>
            <Form.Item name="severity" label="严重程度" rules={[{ required: true }]}>
              <Select options={SEVERITY_OPTIONS} />
            </Form.Item>
          </Col>
          {show('priority') && (
            <Col xs={12} sm={8}>
              <Form.Item name="priority" label="优先级">
                <Select allowClear options={PRIORITY_OPTIONS} />
              </Form.Item>
            </Col>
          )}
          {show('moduleId') && (
            <Col xs={24} sm={8}>
              <Form.Item name="moduleId" label="模块" tooltip="选择模块后自动指派给模块负责人">
                <Select allowClear options={options.modules} />
              </Form.Item>
            </Col>
          )}
        </Row>
        {show('steps') && (
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
        )}
        {show('attachments') && (
          <Form.Item label="附件" style={{ marginBottom: 12 }}>
            <AttachmentPicker value={files} onChange={setFiles} />
          </Form.Item>
        )}
        {more.length > 0 && (
          <Collapse
            ghost
            size="small"
            defaultActiveKey={['more']}
            items={[
              {
                key: 'more',
                label: `更多信息（${more.map((m) => m.label).join('、')}）`,
                forceRender: true,
                children: <Row gutter={12}>{more.map((m) => m.node)}</Row>,
              },
            ]}
          />
        )}
      </Form>
    </Modal>
  );
}
