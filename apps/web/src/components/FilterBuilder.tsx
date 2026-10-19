import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import {
  FILTER_FIELDS,
  FILTER_FIELD_KEYS,
  FILTER_OP_LABEL,
  MAX_FILTER_CONDITIONS,
  VALUELESS_OPS,
  opsFor,
  type FilterCondition,
  type FilterField,
  type FilterFieldDef,
  type FilterGroup,
  type FilterOp,
} from '@defect/shared';
import { Button, DatePicker, Input, InputNumber, Radio, Select, Space, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useState } from 'react';
import type { ProjectDetail } from '../api/types';

const fieldOptions = FILTER_FIELD_KEYS.map((f) => ({ value: f, label: FILTER_FIELDS[f].label }));

/** 组合筛选编辑器：条件之间“全部满足”或“任一满足”，点“应用”后才生效 */
export function FilterBuilder({
  project,
  value,
  onApply,
}: {
  project: ProjectDetail | undefined;
  value: FilterGroup | undefined;
  onApply: (next: FilterGroup | undefined) => void;
}) {
  const [draft, setDraft] = useState<FilterGroup>(
    value ?? { logic: 'and', conditions: [{ field: 'severity', op: 'in', value: [] }] },
  );
  const setCondition = (i: number, patch: Partial<FilterCondition>) =>
    setDraft((d) => ({
      ...d,
      conditions: d.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)),
    }));

  const complete = draft.conditions.filter(isComplete);

  return (
    <div style={{ width: 'min(640px, calc(100vw - 48px))' }}>
      <Space style={{ marginBottom: 12 }}>
        <Typography.Text type="secondary">符合以下</Typography.Text>
        <Radio.Group
          size="small"
          optionType="button"
          value={draft.logic}
          onChange={(e) => setDraft({ ...draft, logic: e.target.value as FilterGroup['logic'] })}
          options={[
            { value: 'and', label: '全部条件' },
            { value: 'or', label: '任一条件' },
          ]}
        />
      </Space>
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        {draft.conditions.map((c, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Select
              size="small"
              style={{ width: 130 }}
              showSearch
              optionFilterProp="label"
              value={c.field}
              options={fieldOptions}
              onChange={(field: FilterField) =>
                setCondition(i, { field, op: opsFor(field)[0]!, value: undefined })
              }
            />
            <Select
              size="small"
              style={{ width: 120 }}
              value={c.op}
              options={opsFor(c.field).map((o) => ({ value: o, label: opLabel(c.field, o) }))}
              onChange={(op: FilterOp) => setCondition(i, { op, value: undefined })}
            />
            <div style={{ flex: 1, minWidth: 180 }}>
              <ValueInput
                project={project}
                condition={c}
                onChange={(v) => setCondition(i, { value: v })}
              />
            </div>
            <Button
              size="small"
              type="text"
              icon={<DeleteOutlined />}
              aria-label="删除条件"
              onClick={() =>
                setDraft({ ...draft, conditions: draft.conditions.filter((_, j) => j !== i) })
              }
            />
          </div>
        ))}
      </Space>
      <div style={{ display: 'flex', marginTop: 12, gap: 8 }}>
        <Button
          size="small"
          icon={<PlusOutlined />}
          disabled={draft.conditions.length >= MAX_FILTER_CONDITIONS}
          onClick={() =>
            setDraft({
              ...draft,
              conditions: [...draft.conditions, { field: 'status', op: 'in', value: [] }],
            })
          }
        >
          添加条件
        </Button>
        <div style={{ flex: 1 }} />
        <Button
          size="small"
          onClick={() => {
            setDraft({ logic: 'and', conditions: [] });
            onApply(undefined);
          }}
        >
          清空
        </Button>
        <Button
          size="small"
          type="primary"
          onClick={() =>
            onApply(complete.length ? { logic: draft.logic, conditions: complete } : undefined)
          }
        >
          应用{complete.length ? `（${complete.length}）` : ''}
        </Button>
      </div>
    </div>
  );
}

function opLabel(field: FilterField, op: FilterOp): string {
  const type = (FILTER_FIELDS[field] as FilterFieldDef).type;
  if (type === 'date' && op === 'gte') return '不早于';
  if (type === 'date' && op === 'lte') return '不晚于';
  if (type === 'number' && op === 'gte') return '不小于';
  if (type === 'number' && op === 'lte') return '不大于';
  return FILTER_OP_LABEL[op];
}

/** 未填完的条件不提交 */
export function isComplete(c: FilterCondition): boolean {
  if (VALUELESS_OPS.includes(c.op)) return true;
  const v = c.value;
  if (Array.isArray(v)) return c.op === 'between' ? v.some(Boolean) : v.length > 0;
  if (typeof v === 'number') return Number.isFinite(v);
  return typeof v === 'string' && v.trim() !== '';
}

function ValueInput({
  project,
  condition: c,
  onChange,
}: {
  project: ProjectDetail | undefined;
  condition: FilterCondition;
  onChange: (v: unknown) => void;
}) {
  if (VALUELESS_OPS.includes(c.op)) return null;
  const def: FilterFieldDef = FILTER_FIELDS[c.field];
  const multi = (options: { value: string; label: string }[]) => (
    <Select
      size="small"
      mode="multiple"
      allowClear
      maxTagCount="responsive"
      optionFilterProp="label"
      style={{ width: '100%' }}
      placeholder="选择"
      value={Array.isArray(c.value) ? (c.value as string[]) : []}
      options={options}
      onChange={onChange}
    />
  );
  const members = [
    { value: 'me', label: '我' },
    ...(project?.members.map((m) => ({ value: m.id, label: m.name })) ?? []),
  ];

  switch (def.type) {
    case 'status':
      return multi(project?.workflow.states.map((s) => ({ value: s.key, label: s.name })) ?? []);
    case 'enum':
      return multi(Object.entries(def.options ?? {}).map(([value, label]) => ({ value, label })));
    case 'user':
    case 'users':
      return multi(members);
    case 'module':
      return multi(project?.modules.map((m) => ({ value: m.id, label: m.name })) ?? []);
    case 'version':
      return multi(project?.versions.map((v) => ({ value: v.id, label: v.name })) ?? []);
    case 'text':
      return (
        <Input
          size="small"
          placeholder="关键字"
          value={typeof c.value === 'string' ? c.value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'number':
      return (
        <InputNumber
          size="small"
          min={0}
          style={{ width: '100%' }}
          value={typeof c.value === 'number' ? c.value : null}
          onChange={(v) => onChange(v ?? undefined)}
        />
      );
    case 'date': {
      const toDay = (v: unknown): Dayjs | null => (typeof v === 'string' && v ? dayjs(v) : null);
      if (c.op === 'between') {
        const [from, to] = Array.isArray(c.value) ? (c.value as (string | null)[]) : [null, null];
        return (
          <DatePicker.RangePicker
            size="small"
            style={{ width: '100%' }}
            allowEmpty={[true, true]}
            value={[toDay(from), toDay(to)]}
            onChange={(r) =>
              onChange([
                r?.[0]?.startOf('day').toISOString() ?? null,
                r?.[1]?.endOf('day').toISOString() ?? null,
              ])
            }
          />
        );
      }
      return (
        <DatePicker
          size="small"
          style={{ width: '100%' }}
          value={toDay(c.value)}
          onChange={(d) =>
            onChange(
              d ? (c.op === 'gte' ? d.startOf('day') : d.endOf('day')).toISOString() : undefined,
            )
          }
        />
      );
    }
  }
}
