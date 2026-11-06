import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import type {
  DefectDetail,
  DefectGroups,
  DefectRow,
  NotificationPage,
  Page,
  ProjectDetail,
  ProjectSummary,
  SavedViewItem,
  SystemVersion,
  TestCaseItem,
  TestCaseModule,
  TestRunDetail,
  TestRunItem,
  UpdateStatus,
} from './types';

export const qk = {
  projects: ['projects'] as const,
  project: (key: string) => ['project', key] as const,
  defects: (key: string, query: Record<string, unknown>) => ['defects', key, query] as const,
  defect: (key: string, code: string) => ['defect', key, code] as const,
  defectGroups: (key: string, query: Record<string, unknown>) =>
    ['defects', key, 'groups', query] as const,
  views: (key: string) => ['views', key] as const,
  tokens: ['tokens'] as const,
  adminUsers: ['admin-users'] as const,
  notifications: ['notifications'] as const,
  report: (key: string, name: string, query: Record<string, unknown>) =>
    ['report', key, name, query] as const,
  /** 自动化测试：用例、模块、执行记录都以 tests/<项目> 为前缀，修改后整体失效 */
  tests: (key: string) => ['tests', key] as const,
  systemVersion: ['system', 'version'] as const,
  updateStatus: ['system', 'update'] as const,
};

/** 当前运行版本与是否有新版本；每 5 分钟刷新，顶部提示与“系统更新”页共用 */
export function useSystemVersion() {
  return useQuery({
    queryKey: qk.systemVersion,
    queryFn: () => api<SystemVersion>('/system/version'),
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });
}

/** 在线更新进度（仅系统管理员）；更新进行中每 2 秒刷新，服务重启期间请求失败也继续轮询 */
export function useUpdateStatus(enabled: boolean, polling: boolean) {
  return useQuery({
    queryKey: qk.updateStatus,
    queryFn: () => api<UpdateStatus>('/system/update'),
    enabled,
    refetchInterval: polling ? 2000 : false,
    retry: polling ? Infinity : 1,
    retryDelay: 2000,
  });
}

export function useProjects() {
  return useQuery({ queryKey: qk.projects, queryFn: () => api<ProjectSummary[]>('/projects') });
}

export function useProject(key: string, enabled = true) {
  return useQuery({
    queryKey: qk.project(key),
    queryFn: () => api<ProjectDetail>(`/projects/${key}`),
    staleTime: 60_000,
    enabled: enabled && !!key,
  });
}

export function useDefects(key: string, query: Record<string, unknown>, enabled = true) {
  return useQuery({
    queryKey: qk.defects(key, query),
    queryFn: () => api<Page<DefectRow>>(`/projects/${key}/defects`, { query }),
    placeholderData: (prev) => prev,
    enabled,
  });
}

export function useDefect(key: string, code: string) {
  return useQuery({
    queryKey: qk.defect(key, code),
    queryFn: () => api<DefectDetail>(`/projects/${key}/defects/${code}`),
  });
}

/** 顶部铃铛的未读数，每 30 秒刷新一次 */
export function useUnreadCount() {
  return useQuery({
    queryKey: [...qk.notifications, 'unread'],
    queryFn: () => api<{ count: number }>('/notifications/unread-count'),
    refetchInterval: 30_000,
  });
}

export function useNotifications(query: { unread: boolean; page: number; pageSize: number }) {
  return useQuery({
    queryKey: [...qk.notifications, query],
    queryFn: () => api<NotificationPage>('/notifications', { query }),
    placeholderData: (prev) => prev,
  });
}

export function useReport<T>(key: string, name: string, query: Record<string, unknown>) {
  return useQuery({
    queryKey: qk.report(key, name, query),
    queryFn: () => api<T>(`/projects/${key}/reports/${name}`, { query }),
    placeholderData: (prev) => prev,
  });
}

/** 分组统计；与列表共用 defects 前缀，新建或修改缺陷后一起失效 */
export function useDefectGroups(key: string, query: Record<string, unknown>, enabled: boolean) {
  return useQuery({
    queryKey: qk.defectGroups(key, query),
    queryFn: () => api<DefectGroups>(`/projects/${key}/defects/groups`, { query }),
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function useSavedViews(key: string) {
  return useQuery({
    queryKey: qk.views(key),
    queryFn: () => api<SavedViewItem[]>(`/projects/${key}/views`),
  });
}

/** 我的待办分组统计 */
export function useTodoGroups(query: Record<string, unknown>, enabled: boolean) {
  return useQuery({
    queryKey: ['todos', 'groups', query],
    queryFn: () => api<DefectGroups>('/me/todos/groups', { query }),
    enabled,
    placeholderData: (prev) => prev,
  });
}

/** 我的待办：跨项目列出指派给我的缺陷 */
export function useTodos(query: Record<string, unknown>) {
  return useQuery({
    queryKey: ['todos', query],
    queryFn: () => api<Page<DefectRow>>('/me/todos', { query }),
    placeholderData: (prev) => prev,
  });
}

/** 待审核的注册数（仅系统管理员），侧边栏“用户管理”旁显示 */
export function usePendingUserCount(enabled: boolean) {
  return useQuery({
    queryKey: [...qk.adminUsers, 'pending-count'],
    queryFn: () => api<{ count: number }>('/admin/users/pending-count'),
    enabled,
    refetchInterval: 60_000,
  });
}

/** 用例库分页列表 */
export function useTestCases(key: string, query: Record<string, unknown>) {
  return useQuery({
    queryKey: [...qk.tests(key), 'cases', query],
    queryFn: () => api<Page<TestCaseItem>>(`/projects/${key}/tests/cases`, { query }),
    placeholderData: (prev) => prev,
  });
}

/** 用例库里出现过的模块（筛选下拉） */
export function useTestCaseModules(key: string) {
  return useQuery({
    queryKey: [...qk.tests(key), 'modules'],
    queryFn: () => api<TestCaseModule[]>(`/projects/${key}/tests/cases/modules`),
  });
}

/** 执行记录列表 */
export function useTestRuns(key: string) {
  return useQuery({
    queryKey: [...qk.tests(key), 'runs'],
    queryFn: () => api<TestRunItem[]>(`/projects/${key}/tests/runs`),
  });
}

/** 一次执行的详情（全部用例结果） */
export function useTestRun(key: string, id: string) {
  return useQuery({
    queryKey: [...qk.tests(key), 'run', id],
    queryFn: () => api<TestRunDetail>(`/projects/${key}/tests/runs/${id}`),
  });
}
