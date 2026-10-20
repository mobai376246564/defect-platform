import { DownOutlined } from '@ant-design/icons';
import { Select } from 'antd';
import { memo, useState, type ReactNode } from 'react';

type Option = { value: string; label: ReactNode; search?: string };

interface Props {
  /** 平时显示的内容（标签、名字等） */
  display: ReactNode;
  options: Option[];
  allowClear?: boolean;
  placeholder?: string;
  onChange: (value: string | null) => void;
}

interface MultiProps {
  display: ReactNode;
  options: Option[];
  placeholder?: string;
  value: string[];
  onChange: (value: string[]) => void;
}

/**
 * 表格单元格里的下拉编辑：平时只渲染显示内容和一个小箭头，点击后才挂载 antd Select 并直接展开。
 * 一页 100 行 × 5 列时页面上不再有 500 个 Select 实例，打开抽屉、拖动列宽、刷新数据都更流畅。
 */
export const CellSelect = memo(function CellSelect({
  value,
  display,
  options,
  allowClear = true,
  placeholder = '—',
  onChange,
}: Props & { value: string | null }) {
  const [editing, setEditing] = useState(false);
  if (!editing) return <CellDisplay display={display} onEdit={() => setEditing(true)} />;
  return (
    <Select
      size="small"
      variant="borderless"
      className="cell-select"
      popupMatchSelectWidth={false}
      autoFocus
      defaultOpen
      value={value ?? undefined}
      placeholder={placeholder}
      allowClear={allowClear}
      options={options}
      onOpenChange={(open) => {
        if (!open) setEditing(false);
      }}
      onChange={(v?: string) => {
        setEditing(false);
        if ((v ?? null) !== value) onChange(v ?? null);
      }}
    />
  );
});

/** 多选（处理人）：选择过程中保持展开，每次勾选都提交；关闭下拉后收起编辑器 */
export const CellMultiSelect = memo(function CellMultiSelect({
  value,
  display,
  options,
  placeholder = '未指派',
  onChange,
}: MultiProps) {
  const [editing, setEditing] = useState(false);
  if (!editing) return <CellDisplay display={display} onEdit={() => setEditing(true)} />;
  return (
    <Select
      size="small"
      mode="multiple"
      variant="borderless"
      className="cell-select"
      maxTagCount={1}
      popupMatchSelectWidth={false}
      autoFocus
      defaultOpen
      placeholder={placeholder}
      value={value}
      optionFilterProp="search"
      options={options}
      onOpenChange={(open) => {
        if (!open) setEditing(false);
      }}
      onChange={(v: string[]) => onChange(v)}
    />
  );
});

function CellDisplay({ display, onEdit }: { display: ReactNode; onEdit: () => void }) {
  return (
    <button type="button" className="cell-display" onClick={onEdit}>
      <span className="cell-display-value">{display}</span>
      <DownOutlined className="cell-display-arrow" />
    </button>
  );
}
