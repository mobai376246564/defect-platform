/**
 * 项目角色与默认权限矩阵（方案 6.8）。
 * 服务端是权限的唯一裁决者；前端只用它决定按钮是否显示。
 */

export const PROJECT_ROLE = {
  admin: '项目管理员',
  product: '产品',
  tester: '测试',
  developer: '开发',
  viewer: '只读',
} as const;
export type ProjectRole = keyof typeof PROJECT_ROLE;
export const PROJECT_ROLES = Object.keys(PROJECT_ROLE) as ProjectRole[];

export type Permission =
  | 'defect.view'
  | 'defect.create'
  | 'defect.edit'
  | 'defect.assign'
  | 'defect.delete'
  | 'defect.export'
  | 'comment.create'
  | 'view.publish'
  | 'project.configure'
  | 'project.members'
  | 'inbox.manage'
  | 'report.view';

const ALL: ProjectRole[] = ['admin', 'product', 'tester', 'developer', 'viewer'];
const EDITORS: ProjectRole[] = ['admin', 'product', 'tester', 'developer'];

export const PERMISSION_MATRIX: Record<Permission, ProjectRole[]> = {
  'defect.view': ALL,
  'defect.create': EDITORS,
  // 开发只能编辑自己处理中的缺陷，服务端另行校验该条件
  'defect.edit': EDITORS,
  'defect.assign': EDITORS,
  'defect.delete': ['admin'],
  'defect.export': EDITORS,
  'comment.create': ALL,
  'view.publish': ['admin', 'product'],
  'project.configure': ['admin'],
  'project.members': ['admin'],
  'inbox.manage': ['admin', 'product', 'tester'],
  'report.view': ALL,
};

export function hasPermission(role: ProjectRole | undefined, permission: Permission): boolean {
  if (!role) return false;
  return PERMISSION_MATRIX[permission].includes(role);
}
