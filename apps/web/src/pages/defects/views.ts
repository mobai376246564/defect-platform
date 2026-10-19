/** 内置视图（方案 6.6）：每个视图是一组固定筛选条件，可与用户的临时筛选叠加。 */
export interface BuiltinView {
  key: string;
  label: string;
  query: Record<string, string>;
}

const OPEN = 'todo,doing,verifying';

export const BUILTIN_VIEWS: BuiltinView[] = [
  { key: 'mine', label: '待我处理', query: { owner: 'me', statusCategory: OPEN } },
  { key: 'created', label: '我创建的', query: { reporter: 'me' } },
  { key: 'open', label: '全部未关闭', query: { statusCategory: OPEN } },
  { key: 'triage', label: '待分诊', query: { status: 'new' } },
  { key: 'verify', label: '待验证', query: { statusCategory: 'verifying', owner: 'me' } },
  { key: 'app', label: '线上反馈', query: { source: 'app', statusCategory: OPEN } },
  { key: 'all', label: '全部', query: {} },
];

export const DEFAULT_VIEW = 'open';

/** 用户可调的筛选字段，与视图条件合并后发给服务端（用户筛选覆盖视图里的同名条件）。 */
export const FILTER_KEYS = ['keyword', 'severity', 'priority', 'status', 'moduleId'] as const;

export function buildQuery(params: URLSearchParams): Record<string, string> {
  const view =
    BUILTIN_VIEWS.find((v) => v.key === (params.get('view') ?? DEFAULT_VIEW)) ?? BUILTIN_VIEWS[2]!;
  const query: Record<string, string> = { ...view.query };
  for (const k of FILTER_KEYS) {
    const v = params.get(k);
    if (v) query[k] = v;
  }
  query.page = params.get('page') ?? '1';
  query.pageSize = params.get('pageSize') ?? '20';
  query.sort = params.get('sort') ?? 'createdAt';
  query.order = params.get('order') ?? 'desc';
  return query;
}
