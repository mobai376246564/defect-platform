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
};

export function useProjects() {
  return useQuery({ queryKey: qk.projects, queryFn: () => api<ProjectSummary[]>('/projects') });
}

export function useProject(key: string) {
  return useQuery({
    queryKey: qk.project(key),
    queryFn: () => api<ProjectDetail>(`/projects/${key}`),
    staleTime: 60_000,
  });
}

export function useDefects(key: string, query: Record<string, unknown>) {
  return useQuery({
    queryKey: qk.defects(key, query),
    queryFn: () => api<Page<DefectRow>>(`/projects/${key}/defects`, { query }),
    placeholderData: (prev) => prev,
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
