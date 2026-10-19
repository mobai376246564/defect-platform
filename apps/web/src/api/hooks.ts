import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import type { DefectDetail, DefectRow, Page, ProjectDetail, ProjectSummary } from './types';

export const qk = {
  projects: ['projects'] as const,
  project: (key: string) => ['project', key] as const,
  defects: (key: string, query: Record<string, unknown>) => ['defects', key, query] as const,
  defect: (key: string, code: string) => ['defect', key, code] as const,
  tokens: ['tokens'] as const,
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
