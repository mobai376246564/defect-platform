/**
 * 缺陷字段枚举。取值与中文标签对标 TAPD 缺陷字段候选值（见方案 6.5），
 * key 使用稳定的英文标识，前端只展示 label，数据库只存 key。
 */

export interface Option<T extends string = string> {
  value: T;
  label: string;
}

function options<T extends string>(map: Record<T, string>): Option<T>[] {
  return (Object.keys(map) as T[]).map((value) => ({ value, label: map[value] }));
}

export const SEVERITY = {
  fatal: '致命',
  serious: '严重',
  normal: '一般',
  prompt: '提示',
  advice: '建议',
} as const;
export type Severity = keyof typeof SEVERITY;
export const SEVERITY_OPTIONS = options(SEVERITY);

export const PRIORITY = {
  urgent: '紧急',
  high: '高',
  medium: '中',
  low: '低',
  insignificant: '无关紧要',
} as const;
export type Priority = keyof typeof PRIORITY;
export const PRIORITY_OPTIONS = options(PRIORITY);

export const FREQUENCY = {
  always: '可重现',
  random: '随机重现',
  never: '不可重现',
} as const;
export type Frequency = keyof typeof FREQUENCY;
export const FREQUENCY_OPTIONS = options(FREQUENCY);

export const RESOLUTION = {
  fixed: '已修改',
  ignore: '无需解决',
  fix_later: '延期解决',
  failed_to_recur: '无法重现',
  external_reason: '外部原因',
  duplicated: '重复',
  intentional_design: '设计如此',
  unclear_description: '问题描述不准确',
  feature_change: '需求变更',
} as const;
export type Resolution = keyof typeof RESOLUTION;
export const RESOLUTION_OPTIONS = options(RESOLUTION);

export const ROOT_CAUSE = {
  requirement: '需求',
  design: '设计',
  coding: '编码',
  other: '其它',
} as const;
export type RootCause = keyof typeof ROOT_CAUSE;
export const ROOT_CAUSE_OPTIONS = options(ROOT_CAUSE);

export const BUG_TYPE = {
  function: '功能',
  ui: '界面',
  performance: '性能',
  compatibility: '兼容',
  crash: '崩溃',
  security: '安全',
  other: '其他',
} as const;
export type BugType = keyof typeof BUG_TYPE;
export const BUG_TYPE_OPTIONS = options(BUG_TYPE);

export const DEFECT_SOURCE = {
  web: '网页提单',
  app: 'APP 反馈',
  api: 'API',
} as const;
export type DefectSource = keyof typeof DEFECT_SOURCE;

export const ATTACHMENT_KIND = {
  image: '图片',
  video: '视频',
  log: '日志',
  other: '其他',
} as const;
export type AttachmentKind = keyof typeof ATTACHMENT_KIND;

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
const VIDEO_EXT = ['mp4', 'mov', 'webm', 'm4v'];
const LOG_EXT = ['log', 'txt', 'zip', 'xlog', 'gz', 'json'];
const AUDIO_EXT = ['m4a', 'mp3', 'wav', 'aac', 'amr'];

/**
 * 允许上传的附件扩展名（网页提单、APP 提单共用）：截图、录屏、日志、原始录音。
 * 不在名单里的（如 html、svg）一律拒绝，避免被当成网页在平台域名下打开。
 */
export const ATTACHMENT_EXTENSIONS: readonly string[] = [
  ...IMAGE_EXT,
  ...VIDEO_EXT,
  ...LOG_EXT,
  ...AUDIO_EXT,
];

function extOf(fileName: string): string {
  return fileName.toLowerCase().split('.').pop() ?? '';
}

export function isAllowedAttachment(fileName: string): boolean {
  return ATTACHMENT_EXTENSIONS.includes(extOf(fileName));
}

/** 根据文件名推断附件类型；录音归为“其他”，原样保存。 */
export function attachmentKindOf(fileName: string): AttachmentKind {
  const ext = extOf(fileName);
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (VIDEO_EXT.includes(ext)) return 'video';
  if (LOG_EXT.includes(ext)) return 'log';
  return 'other';
}

/** 能按文本解析出异常摘要的日志（xlog、gz 是二进制格式，只保存不解析） */
export function isParsableLog(fileName: string): boolean {
  return ['log', 'txt', 'zip', 'json'].includes(extOf(fileName));
}

/** 严重程度排序权重，数值越小越严重。 */
export const SEVERITY_RANK: Record<Severity, number> = {
  fatal: 0,
  serious: 1,
  normal: 2,
  prompt: 3,
  advice: 4,
};
