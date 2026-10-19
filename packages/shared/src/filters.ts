/**
 * 缺陷列表的组合筛选、分组与排序定义（前后端共用）。
 * 服务端按这里的白名单把条件翻译成查询，前端据此渲染筛选器，避免两边字段对不上。
 */
import { BUG_TYPE, DEFECT_SOURCE, FREQUENCY, PRIORITY, SEVERITY } from './enums';
import { STATUS_CATEGORY } from './workflow';

/** 值的类型决定可用的运算符与前端输入控件 */
export type FilterValueType =
  'status' | 'enum' | 'user' | 'users' | 'module' | 'version' | 'text' | 'date' | 'number';

export type FilterOp =
  'in' | 'nin' | 'contains' | 'ncontains' | 'empty' | 'nempty' | 'gte' | 'lte' | 'between' | 'eq';

export const FILTER_OP_LABEL: Record<FilterOp, string> = {
  in: '属于',
  nin: '不属于',
  contains: '包含',
  ncontains: '不包含',
  empty: '为空',
  nempty: '不为空',
  gte: '不早于 / 不小于',
  lte: '不晚于 / 不大于',
  between: '介于',
  eq: '等于',
};

/** 不需要填写值的运算符 */
export const VALUELESS_OPS: FilterOp[] = ['empty', 'nempty'];

const OPS_BY_TYPE: Record<FilterValueType, FilterOp[]> = {
  status: ['in', 'nin'],
  enum: ['in', 'nin', 'empty', 'nempty'],
  user: ['in', 'nin', 'empty', 'nempty'],
  users: ['in', 'nin', 'empty', 'nempty'],
  module: ['in', 'nin', 'empty', 'nempty'],
  version: ['in', 'nin', 'empty', 'nempty'],
  text: ['contains', 'ncontains'],
  date: ['between', 'gte', 'lte', 'empty', 'nempty'],
  number: ['gte', 'lte', 'eq'],
};

export interface FilterFieldDef {
  label: string;
  type: FilterValueType;
  /** type=enum 时的候选值 */
  options?: Record<string, string>;
  /** 字段不可为空时不提供 empty / nempty */
  required?: boolean;
}

export const FILTER_FIELDS = {
  status: { label: '状态', type: 'status', required: true },
  statusCategory: { label: '状态类别', type: 'enum', options: STATUS_CATEGORY, required: true },
  severity: { label: '严重程度', type: 'enum', options: SEVERITY, required: true },
  priority: { label: '优先级', type: 'enum', options: PRIORITY },
  source: { label: '来源', type: 'enum', options: DEFECT_SOURCE, required: true },
  bugType: { label: '缺陷类型', type: 'enum', options: BUG_TYPE },
  frequency: { label: '重现规律', type: 'enum', options: FREQUENCY },
  moduleId: { label: '模块', type: 'module' },
  ownerIds: { label: '处理人', type: 'users' },
  reporterId: { label: '创建人', type: 'user' },
  developerId: { label: '开发人员', type: 'user' },
  verifierId: { label: '验证人', type: 'user' },
  versionFoundId: { label: '发现版本', type: 'version' },
  versionFixedId: { label: '修复版本', type: 'version' },
  title: { label: '标题', type: 'text' },
  description: { label: '描述', type: 'text' },
  createdAt: { label: '创建时间', type: 'date', required: true },
  updatedAt: { label: '更新时间', type: 'date', required: true },
  resolvedAt: { label: '解决时间', type: 'date' },
  closedAt: { label: '关闭时间', type: 'date' },
  dueAt: { label: '截止时间', type: 'date' },
  reopenCount: { label: '重新打开次数', type: 'number', required: true },
  dupCount: { label: '重复反馈次数', type: 'number', required: true },
} as const satisfies Record<string, FilterFieldDef>;

export type FilterField = keyof typeof FILTER_FIELDS;
export const FILTER_FIELD_KEYS = Object.keys(FILTER_FIELDS) as FilterField[];

export function opsFor(field: FilterField): FilterOp[] {
  const def: FilterFieldDef = FILTER_FIELDS[field];
  const ops = OPS_BY_TYPE[def.type];
  return def.required ? ops.filter((o) => !VALUELESS_OPS.includes(o)) : ops;
}

export interface FilterCondition {
  field: FilterField;
  op: FilterOp;
  /** in/nin：字符串数组（用户字段可含 me）；contains：字符串；date：ISO 字符串或 [起, 止]；number：数字 */
  value?: unknown;
}

export interface FilterGroup {
  logic: 'and' | 'or';
  conditions: FilterCondition[];
}

export const MAX_FILTER_CONDITIONS = 20;

/** 可分组的字段；owner 按每个处理人分组，一个缺陷有多个处理人时会出现在多个组里 */
export const GROUP_FIELDS = {
  status: '状态',
  statusCategory: '状态类别',
  severity: '严重程度',
  priority: '优先级',
  moduleId: '模块',
  owner: '处理人',
  reporterId: '创建人',
  developerId: '开发人员',
  source: '来源',
  bugType: '缺陷类型',
  versionFoundId: '发现版本',
} as const;
export type GroupField = keyof typeof GROUP_FIELDS;

/** 分组值为空时使用的占位值 */
export const GROUP_NONE = '__none__';

/** 可排序的字段；严重程度、优先级按等级而不是字母排序 */
export const SORT_FIELDS = {
  createdAt: '创建时间',
  updatedAt: '更新时间',
  severity: '严重程度',
  priority: '优先级',
  seq: '编号',
  dueAt: '截止时间',
  resolvedAt: '解决时间',
  reopenCount: '重新打开次数',
  dupCount: '重复反馈次数',
  title: '标题',
} as const;
export type SortField = keyof typeof SORT_FIELDS;

export interface SortSpec {
  field: SortField;
  order: 'asc' | 'desc';
}

export const MAX_SORT_KEYS = 3;

/** 排序在查询串中的写法：severity:asc,createdAt:desc */
export function formatSort(specs: SortSpec[]): string {
  return specs.map((s) => `${s.field}:${s.order}`).join(',');
}

export function parseSort(text: string | null | undefined): SortSpec[] {
  if (!text) return [];
  const specs: SortSpec[] = [];
  for (const part of text.split(',')) {
    const [field, order = 'desc'] = part.trim().split(':');
    if (!field || !(field in SORT_FIELDS) || (order !== 'asc' && order !== 'desc')) continue;
    if (specs.some((s) => s.field === field)) continue;
    specs.push({ field: field as SortField, order });
  }
  return specs.slice(0, MAX_SORT_KEYS);
}

/** 优先级排序权重，数值越小越紧急。 */
export const PRIORITY_RANK: Record<keyof typeof PRIORITY, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  insignificant: 4,
};
