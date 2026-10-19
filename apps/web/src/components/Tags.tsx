import {
  DEFECT_SOURCE,
  PRIORITY,
  SEVERITY,
  findState,
  type WorkflowDefinition,
} from '@defect/shared';
import { Tag, Typography } from 'antd';

const SEVERITY_COLOR: Record<string, string> = {
  fatal: 'red',
  serious: 'volcano',
  normal: 'gold',
  prompt: 'blue',
  advice: 'default',
};

const PRIORITY_COLOR: Record<string, string> = {
  urgent: 'red',
  high: 'orange',
  medium: 'blue',
  low: 'default',
  insignificant: 'default',
};

export function SeverityTag({ value }: { value: string }) {
  return (
    <Tag color={SEVERITY_COLOR[value]}>{SEVERITY[value as keyof typeof SEVERITY] ?? value}</Tag>
  );
}

export function PriorityTag({ value }: { value: string | null }) {
  if (!value) return <Typography.Text type="secondary">—</Typography.Text>;
  return (
    <Tag color={PRIORITY_COLOR[value]}>{PRIORITY[value as keyof typeof PRIORITY] ?? value}</Tag>
  );
}

export function StatusTag({ value, workflow }: { value: string; workflow: WorkflowDefinition }) {
  const state = findState(workflow, value);
  return <Tag color={state?.color}>{state?.name ?? value}</Tag>;
}

export function SourceTag({ value }: { value: string }) {
  return value === 'app' ? (
    <Tag color="purple">{DEFECT_SOURCE.app}</Tag>
  ) : (
    <span>{DEFECT_SOURCE[value as keyof typeof DEFECT_SOURCE] ?? value}</span>
  );
}
