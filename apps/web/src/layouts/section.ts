export type MenuSection = 'bugs' | 'board' | 'new' | 'reports' | 'settings';

/** 项目内左侧菜单当前高亮项（缺陷详情页归到“缺陷列表”）。 */
export function menuSection(pathname: string): MenuSection {
  if (/\/p\/[^/]+\/settings/.test(pathname)) return 'settings';
  if (/\/p\/[^/]+\/reports/.test(pathname)) return 'reports';
  if (/\/bugs\/board\/?$/.test(pathname)) return 'board';
  if (/\/bugs\/new\/?$/.test(pathname)) return 'new';
  return 'bugs';
}
