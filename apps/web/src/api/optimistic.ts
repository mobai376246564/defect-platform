import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { DefectRow, Page } from './types';

const isPage = (data: unknown): data is Page<DefectRow> =>
  !!data && typeof data === 'object' && Array.isArray((data as Page<DefectRow>).items);

/**
 * 乐观更新：在所有已缓存的缺陷列表（该项目的列表、分组下的各页、我的待办）里就地修改这一行，
 * 页面立刻显示新值，不等请求返回、也不会整表闪一下 loading。返回回滚函数，请求失败时恢复原样。
 */
export function patchCachedRows(
  qc: QueryClient,
  projectKey: string,
  code: string,
  changes: Partial<DefectRow>,
): () => void {
  const snapshots: [QueryKey, unknown][] = [];
  for (const filter of [{ queryKey: ['defects', projectKey] }, { queryKey: ['todos'] }]) {
    for (const [key, data] of qc.getQueriesData(filter)) {
      if (!isPage(data) || !data.items.some((r) => r.code === code)) continue;
      snapshots.push([key, data]);
      qc.setQueryData<Page<DefectRow>>(key, {
        ...data,
        items: data.items.map((r) => (r.code === code ? { ...r, ...changes } : r)),
      });
    }
  }
  return () => {
    for (const [key, data] of snapshots) qc.setQueryData(key, data);
  };
}
