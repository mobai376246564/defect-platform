import { FREQUENCY, PRIORITY, RESOLUTION, ROOT_CAUSE, SEVERITY, findState } from '@defect/shared';
import type { HistoryItem, ProjectDetail } from '../../api/types';

const FIELD_LABEL: Record<string, string> = {
  title: '标题',
  description: '描述',
  steps: '复现步骤',
  expected: '期望结果',
  actual: '实际结果',
  severity: '严重程度',
  priority: '优先级',
  frequency: '重现规律',
  bugType: '缺陷类型',
  rootCause: '缺陷根源',
  resolution: '解决方法',
  moduleId: '模块',
  ownerIds: '处理人',
  ccIds: '抄送人',
  versionFoundId: '发现版本',
  versionFixedId: '合入版本',
  dueAt: '解决期限',
  customFields: '自定义字段',
  status: '状态',
};

const ENUMS: Record<string, Record<string, string>> = {
  severity: SEVERITY,
  priority: PRIORITY,
  frequency: FREQUENCY,
  resolution: RESOLUTION,
  rootCause: ROOT_CAUSE,
};

const LONG_TEXT = new Set(['description', 'steps', 'expected', 'actual', 'customFields']);

/** 把一条变更历史翻译成可读的一句话。 */
export function describeHistory(h: HistoryItem, project: ProjectDetail): string {
  if (h.field === 'created') return '创建了缺陷';
  if (h.field === 'deleted') return '删除了缺陷';
  if (h.field.startsWith('link.')) return `关联了 ${h.field.slice(5)}：${String(h.newValue)}`;
  const label = FIELD_LABEL[h.field] ?? h.field;
  if (LONG_TEXT.has(h.field)) return `修改了${label}`;
  return `将${label}从「${show(h.field, h.oldValue, project)}」改为「${show(h.field, h.newValue, project)}」`;
}

function show(field: string, v: unknown, project: ProjectDetail): string {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0))
    return '空';
  if (field === 'status') return findState(project.workflow, String(v))?.name ?? String(v);
  if (field === 'moduleId') return project.modules.find((m) => m.id === v)?.name ?? '已删除模块';
  if (field === 'versionFoundId' || field === 'versionFixedId') {
    return project.versions.find((x) => x.id === v)?.name ?? String(v);
  }
  if (field === 'ownerIds' || field === 'ccIds') {
    return (v as string[])
      .map((id) => project.members.find((m) => m.id === id)?.name ?? '已移除成员')
      .join('、');
  }
  if (field === 'dueAt') return String(v).slice(0, 10);
  return ENUMS[field]?.[String(v)] ?? String(v);
}
