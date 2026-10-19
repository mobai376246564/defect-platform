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
  /** Git Webhook 地址与密钥状态，仅项目管理员可见 */
  webhook: { url: string; secretConfigured: boolean } | null;
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

export interface NotificationItem {
  id: string;
  kind: 'assigned' | 'mentioned' | 'status_changed';
  title: string;
  body: string;
  projectId: string;
  projectKey: string | null;
  projectName: string | null;
  defectCode: string | null;
  actorName: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage extends Page<NotificationItem> {
  unread: number;
}

/** 统计报表（方案 6.9），字段口径见服务端 ReportsService */
export interface CountItem {
  key: string;
  count: number;
}

export interface TrendReport {
  from: string;
  to: string;
  granularity: 'day' | 'week';
  snapshotDays: number;
  points: { date: string; created: number; resolved: number; closed: number; open: number }[];
}

export interface DistributionReport {
  scope: 'open' | 'created';
  total: number;
  status: CountItem[];
  severity: CountItem[];
  module: CountItem[];
  owner: CountItem[];
  bugType: CountItem[];
  rootCause: CountItem[];
}

export interface AgeReport {
  total: number;
  rows: { bucket: string; label: string; total: number; bySeverity: Record<string, number> }[];
  oldest: {
    code: string;
    title: string;
    status: string;
    severity: string;
    ownerIds: string[];
    createdAt: string;
    ageDays: number;
  }[];
}

export interface VersionReport {
  rows: {
    versionId: string | null;
    name: string;
    releasedAt: string | null;
    total: number;
    open: number;
    openAtRelease: number | null;
    bySeverity: Record<string, number>;
  }[];
}

export interface EfficiencyRow {
  key: string;
  responseCount: number;
  avgResponseHours: number | null;
  resolveCount: number;
  avgResolveHours: number | null;
  slaMet: number;
  slaTotal: number;
  slaRate: number | null;
  inHand: number;
}

export interface EfficiencyReport {
  byPerson: { rows: EfficiencyRow[]; total: EfficiencyRow };
  byModule: { rows: EfficiencyRow[]; total: EfficiencyRow };
}

export interface QualityStats {
  resolved: number;
  reopened: number;
  reopenRate: number | null;
  firstPassRate: number | null;
}

export interface QualityReport {
  granularity: 'day' | 'week';
  summary: QualityStats;
  points: (QualityStats & { date: string })[];
}

export interface FeedbackStats {
  total: number;
  created: number;
  merged: number;
  archived: number;
  failed: number;
  pending: number;
}

export interface FeedbackReportData {
  granularity: 'day' | 'week';
  summary: FeedbackStats & { createRate: number | null };
  points: (FeedbackStats & { date: string })[];
  top: {
    code: string;
    title: string;
    status: string;
    severity: string;
    dupCount: number;
    feedbackCount: number;
    createdAt: string;
  }[];
}

export interface ClaudeGroup {
  count: number;
  avgResolveHours: number | null;
  reopenRate: number | null;
}

export interface ClaudeReport {
  granularity: 'day' | 'week';
  summary: {
    resolved: number;
    withClaude: number;
    ratio: number | null;
    mcpCalls: number;
    claudeComments: number;
  };
  compare: { withClaude: ClaudeGroup; withoutClaude: ClaudeGroup };
  points: { date: string; resolved: number; withClaude: number; ratio: number | null }[];
}
