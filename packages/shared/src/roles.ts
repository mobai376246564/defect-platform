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

/** 用户职位（注册时选择）。加入项目时按职位给默认角色，可再手动调整。 */
export const POSITION = {
  art: '美术',
  operation: '运营',
  design: '策划',
  support: '客服',
  developer: '开发',
  tester: '测试',
  other: '其他',
} as const;
export type Position = keyof typeof POSITION;
export const POSITIONS = Object.keys(POSITION) as Position[];

export const POSITION_DEFAULT_ROLE: Record<Position, ProjectRole> = {
  art: 'viewer',
  operation: 'product',
  design: 'product',
  support: 'viewer',
  developer: 'developer',
  tester: 'tester',
  other: 'viewer',
};

export function defaultRoleForPosition(position: string): ProjectRole {
  return POSITION_DEFAULT_ROLE[position as Position] ?? 'viewer';
}

/** 账号状态：自助注册的账号为 pending，系统管理员审核通过后才能登录。 */
export const USER_STATUS = {
  pending: '待审核',
  active: '正常',
  rejected: '已拒绝',
} as const;
export type UserStatus = keyof typeof USER_STATUS;

/** 登录账号规则：3–32 位字母、数字、下划线、点或横线，不区分大小写。 */
export const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{3,32}$/;
