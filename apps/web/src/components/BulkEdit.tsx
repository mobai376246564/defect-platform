import { EditOutlined } from '@ant-design/icons';
import { BUG_TYPE_OPTIONS, PRIORITY_OPTIONS, SEVERITY_OPTIONS } from '@defect/shared';
import { App, Button, Form, List, Modal, Select, Typography } from 'antd';
import { useState } from 'react';
import type { ProjectDetail } from '../api/types';
import { PriorityTag, SeverityTag, StatusTag } from './Tags';

export type BulkChanges = Record<string, unknown>;

export interface BulkResult {
  total: number;
  updated: number;
  failed: { code: string; message: string }[];
}

type FieldKey =
  'status' | 'severity' | 'priority' | 'ownerIds' | 'moduleId' | 'bugType' | 'versionFoundId';

const FIELD_LABEL: Record<FieldKey, string> = {
  status: '状态',
  severity: '严重程度',
  priority: '优先级',
  ownerIds: '处理人',
  moduleId: '模块',
  bugType: '缺陷类型',
  versionFoundId: '发现版本',
};

/** 允许清空的字段 */
const CLEARABLE: FieldKey[] = ['priority', 'moduleId', 'bugType', 'versionFoundId'];

/**
 * 批量操作栏：显示已选数量，可一键选中全部筛选结果，打开“批量修改”。
 * project 为空（跨项目勾选）时只能改严重程度和优先级。
 */
export function BulkEditBar({
  project,
  selectedCount,
  matchingTotal,
  allMatching,
  onSelectAllMatching,
  onClear,
  onApply,
}: {
  project?: ProjectDetail;
  selectedCount: number;
  matchingTotal?: number;
  allMatching?: boolean;
  onSelectAllMatching?: () => void;
  onClear: () => void;
  onApply: (changes: BulkChanges) => Promise<BulkResult>;
}) {
  const [open, setOpen] = useState(false);
  const count = allMatching && matchingTotal != null ? matchingTotal : selectedCount;
  if (count === 0) return null;
  return (
    <div className="bulk-bar">
      <Typography.Text>
        {allMatching ? '已选择全部筛选结果，共' : '已选择'}{' '}
        <Typography.Text strong className="mono">
          {count}
        </Typography.Text>{' '}
        个缺陷
      </Typography.Text>
      {!allMatching &&
        onSelectAllMatching &&
        matchingTotal != null &&
        matchingTotal > selectedCount && (
          <Button type="link" size="small" style={{ padding: 0 }} onClick={onSelectAllMatching}>
            选择全部 {matchingTotal} 个筛选结果
          </Button>
        )}
      <div style={{ flex: 1 }} />
      <Button type="primary" size="small" icon={<EditOutlined />} onClick={() => setOpen(true)}>
        批量修改
      </Button>
      <Button size="small" type="text" onClick={onClear}>
        取消选择
      </Button>
      <BulkEditModal
        open={open}
        count={count}
        project={project}
        onClose={() => setOpen(false)}
        onApply={onApply}
        onDone={() => {
          setOpen(false);
          onClear();
        }}
      />
    </div>
  );
}

function BulkEditModal({
  open,
  count,
  project,
  onClose,
  onApply,
  onDone,
}: {
  open: boolean;
  count: number;
  project?: ProjectDetail;
  onClose: () => void;
  onApply: (changes: BulkChanges) => Promise<BulkResult>;
  onDone: () => void;
}) {
  const { modal, message } = App.useApp();
  const [field, setField] = useState<FieldKey>('status');
  const [value, setValue] = useState<unknown>(undefined);
  const [saving, setSaving] = useState(false);
  const fields: FieldKey[] = project
    ? ['status', 'severity', 'priority', 'ownerIds', 'moduleId', 'bugType', 'versionFoundId']
    : ['severity', 'priority'];
  const current = fields.includes(field) ? field : fields[0]!;
  const clearable = CLEARABLE.includes(current);
  const ready = value !== undefined && !(current === 'status' && !value);

  const valueInput = () => {
    const common = {
      style: { width: '100%' },
      value: value === null ? '__clear__' : (value as string | string[] | undefined),
      placeholder: `选择${FIELD_LABEL[current]}`,
      onChange: (v: string | string[]) => setValue(v === '__clear__' ? null : v),
    };
    const clearOption = clearable ? [{ value: '__clear__', label: '（清空）' }] : [];
    switch (current) {
      case 'status':
        return (
          <Select
            {...common}
            options={project!.workflow.states.map((s) => ({
              value: s.key,
              label: <StatusTag value={s.key} workflow={project!.workflow} />,
            }))}
          />
        );
      case 'severity':
        return (
          <Select
            {...common}
            options={SEVERITY_OPTIONS.map((o) => ({
              value: o.value,
              label: <SeverityTag value={o.value} />,
            }))}
          />
        );
      case 'priority':
        return (
          <Select
            {...common}
            options={[
              ...clearOption,
              ...PRIORITY_OPTIONS.map((o) => ({
                value: o.value,
                label: <PriorityTag value={o.value} />,
              })),
            ]}
          />
        );
      case 'ownerIds':
        return (
          <Select
            {...common}
            mode="multiple"
            allowClear
            placeholder="选择处理人（留空表示清空处理人）"
            optionFilterProp="label"
            value={(value as string[] | undefined) ?? []}
            onChange={(v: string[]) => setValue(v)}
            options={project!.members.map((m) => ({ value: m.id, label: m.name }))}
          />
        );
      case 'moduleId':
        return (
          <Select
            {...common}
            options={[
              ...clearOption,
              ...project!.modules.map((m) => ({ value: m.id, label: m.name })),
            ]}
          />
        );
      case 'bugType':
        return <Select {...common} options={[...clearOption, ...BUG_TYPE_OPTIONS]} />;
      case 'versionFoundId':
        return (
          <Select
            {...common}
            options={[
              ...clearOption,
              ...project!.versions.map((v) => ({ value: v.id, label: v.name })),
            ]}
          />
        );
    }
  };

  const apply = async () => {
    setSaving(true);
    try {
      const result = await onApply({ [current]: current === 'ownerIds' ? (value ?? []) : value });
      if (result.failed.length === 0) {
        message.success(`已修改 ${result.updated} 个缺陷`);
      } else {
        modal.warning({
          title: `已修改 ${result.updated} 个，${result.failed.length} 个未修改`,
          width: 560,
          content: (
            <List
              size="small"
              style={{ maxHeight: 320, overflow: 'auto' }}
              dataSource={result.failed}
              renderItem={(f) => (
                <List.Item>
                  <Typography.Text className="mono">{f.code}</Typography.Text>
                  <Typography.Text type="secondary">{f.message}</Typography.Text>
                </List.Item>
              )}
            />
          ),
        });
      }
      setValue(undefined);
      onDone();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`批量修改 ${count} 个缺陷`}
      open={open}
      onCancel={onClose}
      onOk={() => void apply()}
      okText="修改"
      okButtonProps={{ disabled: !ready && current !== 'ownerIds' }}
      confirmLoading={saving}
      destroyOnHidden
    >
      <Form layout="vertical">
        <Form.Item label="要修改的字段">
          <Select
            value={current}
            options={fields.map((f) => ({ value: f, label: FIELD_LABEL[f] }))}
            onChange={(f: FieldKey) => {
              setField(f);
              setValue(undefined);
            }}
          />
        </Form.Item>
        <Form.Item
          label="改为"
          extra={
            current === 'status'
              ? '会按工作流逐个切换状态；经典工作流下不能直接到达的状态会被跳过并列出原因'
              : '没有权限修改的缺陷（如开发修改非处理中的缺陷）会被跳过并列出原因'
          }
        >
          {valueInput()}
        </Form.Item>
      </Form>
    </Modal>
  );
}
