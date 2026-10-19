import {
  GROUP_FIELDS,
  formatSort,
  parseSort,
  type FilterGroup,
  type GroupField,
  type SortSpec,
} from '@defect/shared';

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
export const DEFAULT_SORT: SortSpec[] = [{ field: 'createdAt', order: 'desc' }];

/** 自定义视图在 view 参数里的前缀：view=saved:<id> */
export const SAVED_PREFIX = 'saved:';

/** 快捷筛选字段，与视图条件合并后发给服务端（用户筛选覆盖视图里的同名条件）。 */
export const FILTER_KEYS = ['keyword', 'severity', 'priority', 'status', 'moduleId'] as const;

/** 保存到自定义视图里的地址参数（不含视图本身与分页） */
export const SAVED_PARAM_KEYS = [...FILTER_KEYS, 'filters', 'sort', 'groupBy'] as const;

export function readFilters(params: URLSearchParams): FilterGroup | undefined {
  const raw = params.get('filters');
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as FilterGroup;
    return Array.isArray(parsed.conditions) && parsed.conditions.length ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function readSort(params: URLSearchParams): SortSpec[] {
  // 兼容旧链接 sort=createdAt&order=asc
  const sort = params.get('sort');
  const text = sort && !sort.includes(':') ? `${sort}:${params.get('order') ?? 'desc'}` : sort;
  const specs = parseSort(text);
  return specs.length ? specs : DEFAULT_SORT;
}

export function readGroupBy(params: URLSearchParams): GroupField | undefined {
  const g = params.get('groupBy');
  return g && g in GROUP_FIELDS ? (g as GroupField) : undefined;
}

/** 由地址参数生成列表接口的查询条件 */
export function buildQuery(params: URLSearchParams): Record<string, string> {
  const viewKey = params.get('view') ?? DEFAULT_VIEW;
  const query: Record<string, string> = viewKey.startsWith(SAVED_PREFIX)
    ? {}
    : { ...(BUILTIN_VIEWS.find((v) => v.key === viewKey) ?? BUILTIN_VIEWS[2]!).query };
  for (const k of FILTER_KEYS) {
    const v = params.get(k);
    if (v) query[k] = v;
  }
  const filters = readFilters(params);
  if (filters) query.filters = JSON.stringify(filters);
  query.page = params.get('page') ?? '1';
  query.pageSize = params.get('pageSize') ?? '20';
  query.sort = formatSort(readSort(params));
  return query;
}

/** 当前地址参数里需要保存到自定义视图的部分 */
export function savedParams(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of SAVED_PARAM_KEYS) {
    const v = params.get(k);
    if (v) out[k] = v;
  }
  return out;
}

/** 应用自定义视图：清掉当前的筛选、排序、分组，换成视图保存的参数 */
export function applySavedView(
  params: URLSearchParams,
  id: string,
  stored: Record<string, unknown>,
): URLSearchParams {
  const next = new URLSearchParams();
  const pageSize = params.get('pageSize');
  if (pageSize) next.set('pageSize', pageSize);
  next.set('view', `${SAVED_PREFIX}${id}`);
  for (const k of SAVED_PARAM_KEYS) {
    const v = stored[k];
    if (typeof v === 'string' && v) next.set(k, v);
  }
  return next;
}
