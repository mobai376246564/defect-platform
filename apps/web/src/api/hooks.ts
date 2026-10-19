import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import type {
  DefectDetail,
  DefectRow,
  NotificationPage,
  Page,
  ProjectDetail,
  ProjectSummary,
} from './types';

export const qk = {
  projects: ['projects'] as const,
  project: (key: string) => ['project', key] as const,
  defects: (key: string, query: Record<string, unknown>) => ['defects', key, query] as const,
  defect: (key: string, code: string) => ['defect', key, code] as const,
  tokens: ['tokens'] as const,
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
