/**
 * 自动化测试：测试用例与执行结果的取值。数据库只存 key，前端展示 label。
 */
import type { Option } from './enums';

function toOptions<T extends string>(map: Record<T, string>): Option<T>[] {
  return (Object.keys(map) as T[]).map((value) => ({ value, label: map[value] }));
}

export const TEST_CASE_STATUS = {
  draft: '待审核',
  approved: '已审核',
  obsolete: '已废弃',
} as const;
export type TestCaseStatus = keyof typeof TEST_CASE_STATUS;
export const TEST_CASE_STATUS_OPTIONS = toOptions(TEST_CASE_STATUS);

/** 执行方式：auto 可由 Claude 自动执行；manual 只能人工执行（需写明原因） */
export const TEST_CASE_MODE = {
  auto: '自动',
  manual: '人工',
} as const;
export type TestCaseMode = keyof typeof TEST_CASE_MODE;
export const TEST_CASE_MODE_OPTIONS = toOptions(TEST_CASE_MODE);

export const TEST_CASE_ORIGIN = {
  ai: 'Claude 生成',
  manual: '人工编写',
} as const;
export type TestCaseOrigin = keyof typeof TEST_CASE_ORIGIN;

export const TEST_PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;
export type TestPriority = (typeof TEST_PRIORITIES)[number];

/**
 * 用例在一次执行里的结果。doubtful（存疑）用于文案差异、主观表述、实现与需求不一致等需要人判断的情况，
 * 不自动建单（POC 结论，见 调研/自动化测试方案.md 4.2）。
 */
export const TEST_RESULT_STATUS = {
  pending: '未执行',
  passed: '通过',
  failed: '失败',
  doubtful: '存疑',
  blocked: '阻塞',
  skipped: '跳过',
} as const;
export type TestResultStatus = keyof typeof TEST_RESULT_STATUS;
export const TEST_RESULT_STATUS_OPTIONS = toOptions(TEST_RESULT_STATUS);

export const TEST_RUN_STATUS = {
  running: '进行中',
  done: '已结束',
} as const;
export type TestRunStatus = keyof typeof TEST_RUN_STATUS;

/** 用例编号：项目内自增，显示为 TC-12 */
export function testCaseCode(seq: number): string {
  return `TC-${seq}`;
}

/** 执行记录编号：项目内自增，显示为 RUN-3 */
export function testRunCode(seq: number): string {
  return `RUN-${seq}`;
}
