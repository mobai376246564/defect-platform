import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { MAX_SORT_KEYS, SORT_FIELDS, type SortField, type SortSpec } from '@defect/shared';
import { Button, Segmented, Select, Space, Typography } from 'antd';
import { useState } from 'react';

/** 严重程度、优先级的“降序”表示从高到低 */
const RANKED: SortField[] = ['severity', 'priority'];

function orderOptions(field: SortField) {
  return RANKED.includes(field)
    ? [
        { value: 'desc', label: '高→低' },
        { value: 'asc', label: '低→高' },
      ]
    : [
        { value: 'desc', label: '降序' },
        { value: 'asc', label: '升序' },
      ];
}

/** 多字段排序：先按第一项排，相同时再按下一项 */
export function SortEditor({
  value,
  onApply,
}: {
  value: SortSpec[];
  onApply: (next: SortSpec[]) => void;
}) {
  const [draft, setDraft] = useState<SortSpec[]>(value);
  const used = new Set(draft.map((s) => s.field));
  const set = (i: number, patch: Partial<SortSpec>) =>
    setDraft((d) => d.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <div style={{ width: 'min(400px, calc(100vw - 48px))' }}>
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        {draft.map((s, i) => (
          <div key={s.field} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Typography.Text type="secondary" style={{ width: 40 }}>
              {i === 0 ? '先按' : '再按'}
            </Typography.Text>
            <Select
              size="small"
              style={{ flex: 1 }}
              value={s.field}
              options={Object.entries(SORT_FIELDS).map(([f, label]) => ({
                value: f,
                label,
                disabled: f !== s.field && used.has(f as SortField),
              }))}
              onChange={(field: SortField) => set(i, { field })}
            />
            <Segmented
              size="small"
              value={s.order}
              options={orderOptions(s.field)}
              onChange={(order) => set(i, { order: order as SortSpec['order'] })}
            />
            <Button
              size="small"
              type="text"
              icon={<DeleteOutlined />}
              aria-label="删除排序"
              disabled={draft.length === 1}
              onClick={() => setDraft(draft.filter((_, j) => j !== i))}
            />
          </div>
        ))}
      </Space>
      <div style={{ display: 'flex', marginTop: 12, gap: 8 }}>
        <Button
          size="small"
          icon={<PlusOutlined />}
          disabled={draft.length >= MAX_SORT_KEYS}
          onClick={() => {
            const next = (Object.keys(SORT_FIELDS) as SortField[]).find((f) => !used.has(f));
            if (next) setDraft([...draft, { field: next, order: 'desc' }]);
          }}
        >
          添加排序
        </Button>
        <div style={{ flex: 1 }} />
        <Button size="small" type="primary" onClick={() => onApply(draft)}>
          应用
        </Button>
      </div>
    </div>
  );
}

export function describeSort(specs: SortSpec[]): string {
  return specs
    .map((s) => {
      const label = orderOptions(s.field).find((o) => o.value === s.order)?.label ?? '';
      return `${SORT_FIELDS[s.field]} ${label}`;
    })
    .join('，');
}
