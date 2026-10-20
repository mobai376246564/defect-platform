/**
 * 缺陷详情页可由项目管理员控制显示的字段（项目设置 → 字段显示）。
 * 隐藏只影响网页上的展示与新建表单，接口与 MCP 仍返回完整数据，Claude 修复时不受影响。
 * 标题、状态、评论与变更历史始终显示。
 */
export interface DetailFieldDef {
  label: string;
  /** main：正文区；attr：属性区；side：侧栏卡片 */
  area: 'main' | 'attr' | 'side';
  /** 简短说明，显示在设置页 */
  hint?: string;
}

export const DETAIL_FIELDS = {
  steps: { label: '复现步骤', area: 'main' },
  expected: { label: '期望结果', area: 'main' },
  actual: { label: '实际结果', area: 'main' },
  description: { label: '描述', area: 'main' },
  attachments: { label: '附件', area: 'main', hint: '截图、录屏、日志文件' },
  logSummary: { label: '日志摘要', area: 'main', hint: 'APP 反馈自动提取的异常日志' },
  links: { label: '关联提交', area: 'main', hint: '分支、提交、MR' },

  severity: { label: '严重程度', area: 'attr' },
  priority: { label: '优先级', area: 'attr' },
  moduleId: { label: '模块', area: 'attr' },
  ownerIds: { label: '处理人', area: 'attr' },
  reporterId: { label: '创建人', area: 'attr' },
  developerId: { label: '开发人员', area: 'attr' },
  verifierId: { label: '验证人', area: 'attr' },
  frequency: { label: '重现规律', area: 'attr' },
  bugType: { label: '缺陷类型', area: 'attr' },
  versionFoundId: { label: '发现版本', area: 'attr' },
  versionFixedId: { label: '修复版本', area: 'attr' },
  appCommit: { label: 'Git commit', area: 'attr', hint: 'APP 反馈时的代码版本' },
  resolution: { label: '解决方法', area: 'attr' },
  rootCause: { label: '缺陷根源', area: 'attr' },
  dueAt: { label: '截止时间', area: 'attr' },
  source: { label: '来源', area: 'attr' },
  createdAt: { label: '创建时间', area: 'attr' },
  updatedAt: { label: '更新时间', area: 'attr' },

  claude: { label: '用 Claude Code 修复', area: 'side', hint: '复制 /fix-bug 命令' },
  deviceInfo: { label: '环境信息', area: 'side', hint: 'APP 版本、设备、系统、页面路径' },
} as const satisfies Record<string, DetailFieldDef>;

export type DetailField = keyof typeof DETAIL_FIELDS;
export const DETAIL_FIELD_KEYS = Object.keys(DETAIL_FIELDS) as DetailField[];

/** 项目设置里隐藏的字段列表 → 判断某字段是否显示 */
export function isFieldVisible(hidden: readonly string[] | undefined, field: DetailField): boolean {
  return !hidden?.includes(field);
}
