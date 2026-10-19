import type { ProjectRole, WorkflowDefinition, WorkflowTransition } from '@defect/shared';

export interface Me {
  id: string;
  email: string;
  name: string;
  isSystemAdmin: boolean;
}

export interface ProjectSummary {
  id: string;
  key: string;
  name: string;
  description: string;
  role: ProjectRole;
  openDefects: number;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: ProjectRole;
}

export interface ModuleItem {
  id: string;
  name: string;
  parentId: string | null;
  ownerId: string | null;
}

export interface VersionItem {
  id: string;
  name: string;
  build: string | null;
  commit: string | null;
}

export interface ProjectDetail {
  id: string;
  key: string;
  name: string;
  description: string;
  appIds: string[];
  repoUrl: string | null;
  defaultOwnerId: string | null;
  myRole: ProjectRole;
  workflow: WorkflowDefinition;
  modules: ModuleItem[];
  versions: VersionItem[];
  members: Member[];
}

export interface DefectRow {
  id: string;
  code: string;
  title: string;
  status: string;
  statusCategory: string;
  severity: string;
  priority: string | null;
  moduleId: string | null;
  ownerIds: string[];
  reporterId: string | null;
  source: string;
  dupCount: number;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Attachment {
  id: string;
  kind: 'image' | 'video' | 'log' | 'other';
  fileName: string;
  size: number;
  markedAtMs: number | null;
  createdAt: string;
}

export interface Comment {
  id: string;
  authorId: string | null;
  via: 'web' | 'claude' | 'api' | 'system';
  body: string;
  createdAt: string;
}

export interface HistoryItem {
  id: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  operatorId: string | null;
  via: string;
  createdAt: string;
}

export interface LinkItem {
  id: string;
  kind: string;
  target: string;
  state: string | null;
}

export interface DefectDetail extends DefectRow {
  description: string;
  steps: string;
  expected: string;
  actual: string;
  frequency: string | null;
  bugType: string | null;
  resolution: string | null;
  rootCause: string | null;
  ccIds: string[];
  developerId: string | null;
  verifierId: string | null;
  versionFoundId: string | null;
  versionFixedId: string | null;
  appCommit: string | null;
  deviceInfo: unknown;
  logSummary: string | null;
  reopenCount: number;
  attachments: Attachment[];
  comments: Comment[];
  history: HistoryItem[];
  links: LinkItem[];
  transitions: WorkflowTransition[];
  fixCommand: string;
}

export interface UploadTarget {
  driver: 'local' | 'cos';
  prefix: string;
  expiresAt: number;
  cos?: {
    bucket: string;
    region: string;
    credentials: { tmpSecretId: string; tmpSecretKey: string; sessionToken: string };
    startTime: number;
  };
  uploads?: { name: string; key: string; url: string }[];
}

export interface ApiTokenItem {
  id: string;
  name: string;
  prefix: string;
  readOnly: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}
