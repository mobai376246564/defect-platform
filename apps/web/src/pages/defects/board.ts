import {
  SEVERITY_RANK,
  availableTransitions,
  type ProjectRole,
  type Severity,
  type StatusCategory,
  type WorkflowDefinition,
  type WorkflowTransition,
} from '@defect/shared';
import type { DefectRow } from '../../api/types';
import type { TransitionDefect } from '../../components/TransitionModal';

/** 看板一次加载的上限（服务端列表接口 pageSize 上限） */
export const BOARD_LIMIT = 200;

export interface BoardColumn {
  key: string;
  name: string;
  color: string;
  category: StatusCategory;
  items: DefectRow[];
}

/** 列 = 工作流状态（按工作流定义的顺序），列内按严重程度、再按最近更新排序。 */
export function boardColumns(workflow: WorkflowDefinition, defects: DefectRow[]): BoardColumn[] {
  return workflow.states.map((s) => ({
    key: s.key,
    name: s.name,
    color: s.color,
    category: s.category,
    items: defects
      .filter((d) => d.status === s.key)
      .sort(
        (a, b) =>
          (SEVERITY_RANK[a.severity as Severity] ?? 9) -
            (SEVERITY_RANK[b.severity as Severity] ?? 9) || b.updatedAt.localeCompare(a.updatedAt),
      ),
  }));
}

/**
 * 把卡片从 from 列拖到 to 列时对应的流转；当前角色不允许（或工作流没有这条流转）时返回 null，
 * 该列不可放置。服务端仍会按同一套规则再校验一次。
 */
export function dropTransition(
  workflow: WorkflowDefinition,
  role: ProjectRole | undefined,
  from: string,
  to: string,
): WorkflowTransition | null {
  if (from === to) return null;
  return availableTransitions(workflow, from, role).find((t) => t.to === to) ?? null;
}

const isEmpty = (v: unknown) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** 流转需要填说明，或必填字段在卡片上还没有值时，弹窗补填；否则直接流转。 */
export function needsForm(t: WorkflowTransition, defect: TransitionDefect): boolean {
  if (t.requiresComment) return true;
  return t.requiredFields.some((f) => isEmpty((defect as Record<string, unknown>)[f]));
}
