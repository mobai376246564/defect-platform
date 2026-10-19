/**
 * 可配置工作流（方案 6.3 / 6.7）。
 * 统计与 SLA 一律按状态类别计算，项目改状态名不影响口径。
 */
import type { ProjectRole } from './roles';

export const STATUS_CATEGORY = {
  todo: '未开始',
  doing: '进行中',
  verifying: '待验证',
  done: '已完成',
} as const;
export type StatusCategory = keyof typeof STATUS_CATEGORY;

export interface WorkflowState {
  key: string;
  name: string;
  category: StatusCategory;
  color: string;
}

/** 流转成功后由服务端执行的动作。 */
export type TransitionAction =
  | 'auto_assign'
  | 'record_developer'
  | 'assign_to_verifier'
  | 'assign_back_to_developer'
  | 'increment_reopen';

export interface WorkflowTransition {
  key: string;
  from: string;
  to: string;
  label: string;
  /** 允许的项目角色；为空且 system=true 表示仅系统（如 Webhook）可触发。 */
  roles: ProjectRole[];
  /** 流转时必须有值的缺陷字段。 */
  requiredFields: string[];
  /** 流转时必须附带说明（会作为评论保存），如重新打开的原因。 */
  requiresComment?: boolean;
  system?: boolean;
  actions?: TransitionAction[];
}

export interface WorkflowDefinition {
  initialState: string;
  states: WorkflowState[];
  transitions: WorkflowTransition[];
}

const TESTERS: ProjectRole[] = ['admin', 'product', 'tester'];
const DEVS: ProjectRole[] = ['admin', 'developer'];

export const DEFAULT_WORKFLOW: WorkflowDefinition = {
  initialState: 'new',
  states: [
    { key: 'new', name: '新建', category: 'todo', color: '#8c8c8c' },
    { key: 'confirmed', name: '已确认', category: 'todo', color: '#1677ff' },
    { key: 'in_progress', name: '处理中', category: 'doing', color: '#fa8c16' },
    { key: 'in_review', name: '待代码审核', category: 'doing', color: '#722ed1' },
    { key: 'resolved', name: '已解决', category: 'verifying', color: '#13c2c2' },
    { key: 'closed', name: '已关闭', category: 'done', color: '#52c41a' },
    { key: 'rejected', name: '已拒绝', category: 'done', color: '#bfbfbf' },
  ],
  transitions: [
    {
      key: 'confirm',
      from: 'new',
      to: 'confirmed',
      label: '确认',
      roles: TESTERS,
      requiredFields: ['priority', 'moduleId'],
      actions: ['auto_assign'],
    },
    {
      key: 'reject',
      from: 'new',
      to: 'rejected',
      label: '拒绝',
      roles: TESTERS,
      requiredFields: ['resolution'],
    },
    {
      key: 'start',
      from: 'confirmed',
      to: 'in_progress',
      label: '开始处理',
      roles: DEVS,
      requiredFields: [],
      actions: ['record_developer'],
    },
    {
      key: 'submit_review',
      from: 'in_progress',
      to: 'in_review',
      label: '提交审核',
      roles: DEVS,
      requiredFields: [],
    },
    {
      key: 'resolve',
      from: 'in_progress',
      to: 'resolved',
      label: '直接解决',
      roles: DEVS,
      requiredFields: ['resolution'],
      requiresComment: true,
      actions: ['assign_to_verifier'],
    },
    {
      key: 'merged',
      from: 'in_review',
      to: 'resolved',
      label: '标记已合并',
      roles: DEVS,
      requiredFields: [],
      actions: ['assign_to_verifier'],
    },
    {
      key: 'verify',
      from: 'resolved',
      to: 'closed',
      label: '验证通过',
      roles: TESTERS,
      requiredFields: [],
    },
    {
      key: 'reopen',
      from: 'resolved',
      to: 'in_progress',
      label: '重新打开',
      roles: TESTERS,
      requiredFields: [],
      requiresComment: true,
      actions: ['assign_back_to_developer', 'increment_reopen'],
    },
    {
      key: 'reopen_closed',
      from: 'closed',
      to: 'in_progress',
      label: '重新打开',
      roles: TESTERS,
      requiredFields: [],
      requiresComment: true,
      actions: ['assign_back_to_developer', 'increment_reopen'],
    },
  ],
};

export function findState(def: WorkflowDefinition, key: string): WorkflowState | undefined {
  return def.states.find((s) => s.key === key);
}

/** 当前状态下，指定角色可见的流转按钮。 */
export function availableTransitions(
  def: WorkflowDefinition,
  fromState: string,
  role: ProjectRole | undefined,
): WorkflowTransition[] {
  if (!role) return [];
  return def.transitions.filter((t) => t.from === fromState && !t.system && t.roles.includes(role));
}

export type TransitionCheck =
  | { ok: true; transition: WorkflowTransition }
  | {
      ok: false;
      reason: 'not_found' | 'wrong_state' | 'forbidden' | 'missing_fields' | 'missing_comment';
      missing?: string[];
    };

/**
 * 校验一次流转是否合法。actor 为 'system' 表示由 Webhook 等系统触发。
 */
export function checkTransition(
  def: WorkflowDefinition,
  input: {
    transitionKey: string;
    currentState: string;
    actor: ProjectRole | 'system';
    values: Record<string, unknown>;
    comment?: string;
  },
): TransitionCheck {
  const transition = def.transitions.find((t) => t.key === input.transitionKey);
  if (!transition) return { ok: false, reason: 'not_found' };
  if (transition.from !== input.currentState) return { ok: false, reason: 'wrong_state' };
  if (input.actor !== 'system' && !transition.roles.includes(input.actor)) {
    return { ok: false, reason: 'forbidden' };
  }
  const missing = transition.requiredFields.filter((f) => isEmpty(input.values[f]));
  if (missing.length > 0) return { ok: false, reason: 'missing_fields', missing };
  if (transition.requiresComment && !input.comment?.trim()) {
    return { ok: false, reason: 'missing_comment' };
  }
  return { ok: true, transition };
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

/**
 * 校验工作流定义本身：状态 key 唯一、流转引用的状态存在、
 * 每个状态都能到达“已完成”类别（方案 6.7 保存时校验）。
 */
export function validateWorkflow(def: WorkflowDefinition): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  for (const s of def.states) {
    if (keys.has(s.key)) errors.push(`状态 key 重复：${s.key}`);
    keys.add(s.key);
  }
  if (!keys.has(def.initialState)) errors.push(`初始状态不存在：${def.initialState}`);
  for (const t of def.transitions) {
    if (!keys.has(t.from)) errors.push(`流转 ${t.key} 的起始状态不存在：${t.from}`);
    if (!keys.has(t.to)) errors.push(`流转 ${t.key} 的目标状态不存在：${t.to}`);
  }
  const done = new Set(def.states.filter((s) => s.category === 'done').map((s) => s.key));
  if (done.size === 0) errors.push('至少需要一个“已完成”类别的状态');
  // 反向 BFS：从已完成状态出发，沿流转反向找能到达的状态
  const reachable = new Set(done);
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of def.transitions) {
      if (reachable.has(t.to) && !reachable.has(t.from)) {
        reachable.add(t.from);
        changed = true;
      }
    }
  }
  for (const s of def.states) {
    if (!reachable.has(s.key)) errors.push(`状态“${s.name}”无法到达已完成类别`);
  }
  return errors;
}
