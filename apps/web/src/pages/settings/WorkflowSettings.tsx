import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import {
  STATUS_CATEGORY,
  validateWorkflow,
  type StatusCategory,
  type WorkflowDefinition,
  type WorkflowState,
} from '@defect/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Card,
  ColorPicker,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import { qk, useDefectGroups } from '../../api/hooks';
import type { ProjectDetail } from '../../api/types';

const CATEGORY_HINT: Record<StatusCategory, string> = {
  todo: '还没开始处理，如待处理',
  doing: '正在处理，如处理中、重新打开',
  verifying: '等测试验证，如待回归；进入时自动指派给提单人',
  done: '已结束，如测试通过、不是bug',
};

const PRESET_COLORS = [
  '#1677ff',
  '#fa8c16',
  '#13c2c2',
  '#52c41a',
  '#f5222d',
  '#8c8c8c',
  '#722ed1',
  '#eb2f96',
];

interface Draft {
  initialState: string;
  states: WorkflowState[];
  mergeTarget?: string;
}

/**
 * 缺陷状态（自由流转）：管理员增删改状态、调整顺序、设置初始状态与 MR 合并后的状态。
 * 删除仍有缺陷的状态时，保存前选择这些缺陷迁移到哪个状态。保存后所有人的状态下拉框立即同步。
 */
export function WorkflowSettings({
  project,
  editable,
}: {
  project: ProjectDetail;
  editable: boolean;
}) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const wf = project.workflow;
  const toDraft = (w: WorkflowDefinition): Draft => ({
    initialState: w.initialState,
    states: w.states.map((s) => ({ ...s })),
    mergeTarget: w.mergeTarget,
  });
  const [draft, setDraft] = useState<Draft>(() => toDraft(wf));
  useEffect(() => setDraft(toDraft(wf)), [wf]);
  const [remapOpen, setRemapOpen] = useState(false);
  const [remap, setRemap] = useState<Record<string, string>>({});

  const groups = useDefectGroups(project.key, { groupBy: 'status' }, true);
  const counts = useMemo(
    () => new Map((groups.data?.groups ?? []).map((g) => [g.value, g.count])),
    [groups.data],
  );
  const removedWithDefects = wf.states.filter(
    (s) => !draft.states.some((d) => d.key === s.key) && (counts.get(s.key) ?? 0) > 0,
  );
  const next: WorkflowDefinition = {
    mode: 'free',
    initialState: draft.initialState,
    states: draft.states,
    transitions: [],
    mergeTarget: draft.mergeTarget,
  };
  const errors = validateWorkflow(next);
  const dirty = JSON.stringify(toDraft(wf)) !== JSON.stringify(draft) || wf.mode !== 'free';

  const save = useMutation({
    mutationFn: (body: object) => api(`/projects/${project.key}/workflow`, { method: 'PUT', body }),
    onSuccess: () => {
      message.success('缺陷状态已保存，所有人立即生效');
      setRemapOpen(false);
      setRemap({});
      void qc.invalidateQueries({ queryKey: qk.project(project.key) });
      void qc.invalidateQueries({ queryKey: ['defects', project.key] });
    },
    onError: (e: Error) => message.error(e.message),
  });
  const submit = () => {
    if (removedWithDefects.length && !remapOpen) {
      setRemap(
        Object.fromEntries(
          removedWithDefects.map((s) => [
            s.key,
            draft.states.find((d) => d.category === s.category)?.key ?? draft.initialState,
          ]),
        ),
      );
      setRemapOpen(true);
      return;
    }
    save.mutate({ ...next, remap });
  };

  const update = (key: string, patch: Partial<WorkflowState>) =>
    setDraft((d) => ({
      ...d,
      states: d.states.map((s) => (s.key === key ? { ...s, ...patch } : s)),
    }));
  const move = (index: number, delta: number) =>
    setDraft((d) => {
      const states = [...d.states];
      const [s] = states.splice(index, 1);
      states.splice(index + delta, 0, s!);
      return { ...d, states };
    });
  const remove = (key: string) =>
    setDraft((d) => ({
      ...d,
      states: d.states.filter((s) => s.key !== key),
      mergeTarget: d.mergeTarget === key ? undefined : d.mergeTarget,
    }));
  const add = () =>
    setDraft((d) => ({
      ...d,
      states: [
        ...d.states,
        {
          key: `s_${Date.now().toString(36)}`,
          name: '新状态',
          category: 'doing',
          color: PRESET_COLORS[d.states.length % PRESET_COLORS.length]!,
        },
      ],
    }));

  if (wf.mode !== 'free') {
    return (
      <Card title="缺陷状态">
        <Alert
          type="info"
          showIcon
          message="本项目使用经典工作流（按固定步骤流转，限定角色与必填字段）"
          description="切换为自由流转后，任意状态之间都可以直接切换，现有状态保持不变，可以在这里增删改。"
          action={
            editable && (
              <Button type="primary" loading={save.isPending} onClick={() => save.mutate(next)}>
                切换为自由流转
              </Button>
            )
          }
        />
      </Card>
    );
  }

  return (
    <Card
      title="缺陷状态"
      extra={
        <Typography.Text type="secondary">
          任意状态之间都可以直接切换，保存后立即对所有人生效
        </Typography.Text>
      }
    >
      <Table<WorkflowState>
        rowKey="key"
        size="small"
        pagination={false}
        scroll={{ x: 'max-content' }}
        dataSource={draft.states}
        columns={[
          {
            title: '颜色',
            width: 64,
            render: (_, s) => (
              <ColorPicker
                size="small"
                disabled={!editable}
                value={s.color}
                presets={[{ label: '常用', colors: PRESET_COLORS }]}
                onChangeComplete={(c) => update(s.key, { color: c.toHexString() })}
              />
            ),
          },
          {
            title: '名称',
            width: 200,
            render: (_, s) => (
              <Input
                size="small"
                maxLength={20}
                disabled={!editable}
                value={s.name}
                onChange={(e) => update(s.key, { name: e.target.value })}
                style={{ width: 180 }}
              />
            ),
          },
          {
            title: '类别',
            width: 170,
            render: (_, s) => (
              <Select
                size="small"
                disabled={!editable}
                value={s.category}
                style={{ width: 150 }}
                options={Object.entries(STATUS_CATEGORY).map(([value, label]) => ({
                  value,
                  label,
                  title: CATEGORY_HINT[value as StatusCategory],
                }))}
                onChange={(category: StatusCategory) => update(s.key, { category })}
              />
            ),
          },
          {
            title: '新建时',
            width: 80,
            render: (_, s) => (
              <Radio
                disabled={!editable}
                checked={draft.initialState === s.key}
                onChange={() => setDraft((d) => ({ ...d, initialState: s.key }))}
              />
            ),
          },
          {
            title: '缺陷数',
            width: 72,
            render: (_, s) => <span className="mono">{counts.get(s.key) ?? 0}</span>,
          },
          {
            title: '',
            width: 112,
            render: (_, s, i) =>
              editable && (
                <Space size={0}>
                  <Button
                    type="text"
                    size="small"
                    icon={<ArrowUpOutlined />}
                    aria-label="上移"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  />
                  <Button
                    type="text"
                    size="small"
                    icon={<ArrowDownOutlined />}
                    aria-label="下移"
                    disabled={i === draft.states.length - 1}
                    onClick={() => move(i, 1)}
                  />
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label="删除"
                    disabled={draft.initialState === s.key || draft.states.length <= 2}
                    onClick={() => remove(s.key)}
                  />
                </Space>
              ),
          },
        ]}
      />

      {editable && (
        <Button icon={<PlusOutlined />} style={{ marginTop: 12 }} onClick={add}>
          添加状态
        </Button>
      )}

      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 20, flexWrap: 'wrap' }}
      >
        <Typography.Text>MR 合并后自动转为</Typography.Text>
        <Select
          allowClear
          disabled={!editable}
          placeholder="第一个“待验证”类别的状态"
          style={{ width: 220 }}
          value={draft.mergeTarget}
          options={draft.states.map((s) => ({ value: s.key, label: s.name }))}
          onChange={(v?: string) => setDraft((d) => ({ ...d, mergeTarget: v }))}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          仅对“未开始 / 进行中”类别的缺陷生效（需在“集成”里配置 Git Webhook）
        </Typography.Text>
      </div>

      <Typography.Paragraph
        type="secondary"
        style={{ fontSize: 12, marginTop: 16, marginBottom: 0 }}
      >
        类别决定统计口径与自动规则：进入“待验证”类别时自动指派给提单人；从“待验证 /
        已完成”回到“未开始 / 进行中”算作重新打开，指派回开发并累计重开次数。
      </Typography.Paragraph>

      {errors.length > 0 && (
        <Alert type="warning" showIcon style={{ marginTop: 12 }} message={errors.join('；')} />
      )}

      {editable && (
        <Space style={{ marginTop: 16 }}>
          <Button
            type="primary"
            disabled={!dirty || errors.length > 0 || draft.states.some((s) => !s.name.trim())}
            loading={save.isPending}
            onClick={submit}
          >
            保存
          </Button>
          <Button disabled={!dirty} onClick={() => setDraft(toDraft(wf))}>
            撤销修改
          </Button>
        </Space>
      )}

      <Modal
        title="迁移被删除状态上的缺陷"
        open={remapOpen}
        onCancel={() => setRemapOpen(false)}
        onOk={submit}
        okText="迁移并保存"
        confirmLoading={save.isPending}
      >
        <Typography.Paragraph type="secondary">
          以下状态还有缺陷，删除前请选择把它们改成哪个状态（会记入缺陷的变更历史）：
        </Typography.Paragraph>
        <Space direction="vertical" style={{ width: '100%' }}>
          {removedWithDefects.map((s) => (
            <Space key={s.key} wrap>
              <Tag color={s.color}>{s.name}</Tag>
              <Typography.Text type="secondary">{counts.get(s.key)} 个缺陷 →</Typography.Text>
              <Select
                style={{ width: 160 }}
                value={remap[s.key]}
                options={draft.states.map((d) => ({ value: d.key, label: d.name }))}
                onChange={(v: string) => setRemap((r) => ({ ...r, [s.key]: v }))}
              />
            </Space>
          ))}
        </Space>
      </Modal>
    </Card>
  );
}
