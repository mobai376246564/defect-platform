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
  /**
   * free：自由流转，任意状态之间可以直接切换，流转由状态列表自动生成（transitions 留空）；
   * strict（缺省）：只允许 transitions 里定义的流转，可配置角色、必填字段与说明。
   */
  mode?: 'free' | 'strict';
  initialState: string;
  states: WorkflowState[];
  transitions: WorkflowTransition[];
  /** MR 合并后自动流转到的状态（自由流转模式）；不设置时取第一个“待验证”类别的状态 */
  mergeTarget?: string;
}

const TESTERS: ProjectRole[] = ['admin', 'product', 'tester'];
const DEVS: ProjectRole[] = ['admin', 'developer'];
/** 自由流转模式下能改状态的角色（只读成员不能改） */
export const FREE_TRANSITION_ROLES: ProjectRole[] = ['admin', 'product', 'tester', 'developer'];

/**
 * 默认工作流：自由流转。新建缺陷即“待处理”，之后直接选择目标状态；
 * 自动指派、重开计数等按状态类别的变化触发（见 freeTransitionActions）。
 */
export const DEFAULT_WORKFLOW: WorkflowDefinition = {
  mode: 'free',
  initialState: 'pending',
  states: [
    { key: 'pending', name: '待处理', category: 'todo', color: '#1677ff' },
    { key: 'in_progress', name: '处理中', category: 'doing', color: '#fa8c16' },
    { key: 'to_verify', name: '待回归', category: 'verifying', color: '#13c2c2' },
    { key: 'passed', name: '测试通过', category: 'done', color: '#52c41a' },
    { key: 'reopened', name: '重新打开', category: 'doing', color: '#f5222d' },
    { key: 'not_bug', name: '不是bug', category: 'done', color: '#8c8c8c' },
  ],
  transitions: [],
  mergeTarget: 'to_verify',
};

/**
 * 经典工作流（严格流转）：新建 → 确认 → 处理中 → 待代码审核 → 已解决 → 关闭，
 * 每一步限定角色与必填字段。可通过“工作流配置”接口切换到这种模式。
 */
export const CLASSIC_WORKFLOW: WorkflowDefinition = {
  mode: 'strict',
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

/** 自由流转模式下切换到某状态的流转 key，与起始状态无关 */
export const freeTransitionKey = (toState: string) => `to_${toState}`;

/**
 * 自由流转时按状态类别的变化自动执行的动作：
 * 从待处理进入进行中记下开发人员；进入待验证指派给验证人；从待验证 / 已完成回到未完成视为重新打开。
 */
export function freeTransitionActions(
  from: StatusCategory,
  to: StatusCategory,
): TransitionAction[] {
  if ((from === 'verifying' || from === 'done') && (to === 'todo' || to === 'doing')) {
    return ['assign_back_to_developer', 'increment_reopen'];
  }
  if (to === 'verifying') return ['assign_to_verifier'];
  if (from === 'todo' && to === 'doing') return ['record_developer'];
  return [];
}

/** 实际生效的流转：自由流转模式由状态两两生成，严格模式即配置的 transitions */
export function effectiveTransitions(def: WorkflowDefinition): WorkflowTransition[] {
  if (def.mode !== 'free') return def.transitions;
  return def.states.flatMap((from) =>
    def.states
      .filter((to) => to.key !== from.key)
      .map((to) => ({
        key: freeTransitionKey(to.key),
        from: from.key,
        to: to.key,
        label: to.name,
        roles: FREE_TRANSITION_ROLES,
        requiredFields: [],
        actions: freeTransitionActions(from.category, to.category),
      })),
  );
}

/** MR 合并后自动流转到的状态（自由流转模式） */
export function mergeTargetState(def: WorkflowDefinition): WorkflowState | undefined {
  return (
    (def.mergeTarget ? findState(def, def.mergeTarget) : undefined) ??
    def.states.find((s) => s.category === 'verifying')
  );
}

/** 当前状态下，指定角色可见的流转按钮。 */
export function availableTransitions(
  def: WorkflowDefinition,
  fromState: string,
  role: ProjectRole | undefined,
): WorkflowTransition[] {
  if (!role) return [];
  return effectiveTransitions(def).filter(
    (t) => t.from === fromState && !t.system && t.roles.includes(role),
  );
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
  const all = effectiveTransitions(def);
  // 自由流转模式下同一 key 对应多个起始状态，优先取从当前状态出发的那条
  const transition =
    all.find((t) => t.key === input.transitionKey && t.from === input.currentState) ??
    all.find((t) => t.key === input.transitionKey);
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
  if (def.mode === 'free') {
    // 自由流转：任意状态都能直接切到“已完成”类别，只需保证有这样的状态
    if (!def.states.some((s) => s.category === 'done')) {
      errors.push('至少需要一个“已完成”类别的状态');
    }
    if (def.mergeTarget && !keys.has(def.mergeTarget)) {
      errors.push(`MR 合并后的目标状态不存在：${def.mergeTarget}`);
    }
    return errors;
  }
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
