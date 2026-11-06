/**
 * 自动化测试：用例文件的列、取值与标签。
 * 用例文件与团队的 Excel 用例表一一对应（概览 / 测试点汇总 / 需求待确认 / 每个模块一个工作表），
 * 平台展示、Excel 导入导出与 Claude 生成都用这里的定义，保证三处一致。
 */
import type { Option } from './enums';

function toOptions<T extends string>(map: Record<T, string>): Option<T>[] {
  return (Object.keys(map) as T[]).map((value) => ({ value, label: map[value] }));
}

/**
 * 测试结果。doubtful（存疑）用于文案差异、主观表述、实现与需求不一致等需要人判断的情况，
 * 不自动建单（POC 结论，见 调研/自动化测试方案.md 4.2）。
 */
export const TEST_RESULT = {
  pending: '未执行',
  passed: '通过',
  failed: '失败',
  doubtful: '存疑',
  blocked: '阻塞',
  na: '不适用',
} as const;
export type TestResult = keyof typeof TEST_RESULT;
export const TEST_RESULT_OPTIONS = toOptions(TEST_RESULT);

/** 执行方式：auto 可由 Claude 自动执行；manual 只能人工执行 */
export const TEST_CASE_MODE = {
  auto: '自动',
  manual: '人工',
} as const;
export type TestCaseMode = keyof typeof TEST_CASE_MODE;
export const TEST_CASE_MODE_OPTIONS = toOptions(TEST_CASE_MODE);

export const TEST_PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;
export type TestPriority = (typeof TEST_PRIORITIES)[number];

/** 用例类型（与团队用例表一致） */
export const TEST_CASE_TYPES = [
  '功能',
  '边界',
  '异常',
  'UI',
  '交互',
  '文案',
  '兼容',
  '服务端',
  '硬件',
] as const;

/**
 * 没写执行方式时按用例类型推断：硬件、服务端类要看设备、改服务器时间或抓包，归为人工。
 */
export function inferTestCaseMode(caseType: string): TestCaseMode {
  return caseType === '硬件' || caseType === '服务端' ? 'manual' : 'auto';
}

/** 模块工作表里的列，顺序即 Excel 的列顺序（最后一列「执行方式」是平台加的） */
export const TEST_CASE_COLUMNS = [
  { key: 'code', label: '用例编号', width: 13 },
  { key: 'docName', label: '需求文档', width: 18 },
  { key: 'module', label: '模块', width: 14 },
  { key: 'subModule', label: '子模块', width: 16 },
  { key: 'testPoint', label: '测试点', width: 18 },
  { key: 'title', label: '用例标题', width: 30 },
  { key: 'priority', label: '优先级', width: 7 },
  { key: 'caseType', label: '用例类型', width: 8 },
  { key: 'precondition', label: '前置条件', width: 28 },
  { key: 'steps', label: '测试步骤', width: 40 },
  { key: 'expected', label: '预期结果', width: 50 },
  { key: 'actualResult', label: '实际结果', width: 16 },
  { key: 'result', label: '测试结果', width: 10 },
  { key: 'remark', label: '备注', width: 16 },
  { key: 'mode', label: '执行方式', width: 10 },
] as const;
export type TestCaseColumnKey = (typeof TEST_CASE_COLUMNS)[number]['key'];

/** 固定的三个汇总工作表名 */
export const TEST_SUITE_FIXED_SHEETS = {
  overview: '概览',
  points: '测试点汇总',
  questions: '需求待确认',
} as const;

/** 概览页默认的说明（导入的 Excel 没有说明、或 Claude 生成时没写时使用） */
export const DEFAULT_SUITE_NOTES = [
  '优先级说明：P0 核心功能/主流程/数据安全；P1 重要功能与边界；P2 一般功能、体验与UI细节；P3 细节',
  '用例类型：功能 / 边界 / 异常 / UI / 交互 / 文案 / 兼容 / 服务端 / 硬件；服务端、硬件类需联调环境或抓包、改服务器时间执行',
  '执行方式：自动 = 可由 Claude 在 Unity 编辑器或真机上执行；人工 = 需要人工执行',
  '预期结果中标注「待确认」的用例，执行前请先对照「需求待确认」页的结论',
];

/** 由中文标签反查结果 key（Excel 导入用），认不出的当作未执行 */
export function testResultFromLabel(label: string): TestResult {
  const hit = (Object.keys(TEST_RESULT) as TestResult[]).find(
    (k) => TEST_RESULT[k] === label.trim(),
  );
  return hit ?? 'pending';
}

/** 由中文标签或 key 反查执行方式，认不出返回 null（再按用例类型推断） */
export function testModeFromLabel(label: string): TestCaseMode | null {
  const v = label.trim();
  if (v === 'auto' || v === TEST_CASE_MODE.auto) return 'auto';
  if (v === 'manual' || v === TEST_CASE_MODE.manual) return 'manual';
  return null;
}

/** 汇总用到的用例字段 */
export interface TestCaseLike {
  code: string;
  sheet: string;
  module: string;
  subModule: string;
  testPoint: string;
  priority: string;
  result: string;
}

/** 测试点汇总的一行：同一工作表里「模块 + 子模块 + 测试点」相同的用例归为一个测试点 */
export interface TestPointRow {
  sheet: string;
  module: string;
  subModule: string;
  testPoint: string;
  codes: string[];
}

/**
 * 按工作表顺序、用例出现顺序汇总测试点（「测试点汇总」工作表）。
 * @param cases 用例（已按工作表内顺序排好）
 * @param sheetOrder 工作表名顺序
 */
export function summarizeTestPoints(cases: TestCaseLike[], sheetOrder: string[]): TestPointRow[] {
  const rank = new Map(sheetOrder.map((s, i) => [s, i]));
  const sorted = [...cases].sort((a, b) => (rank.get(a.sheet) ?? 999) - (rank.get(b.sheet) ?? 999));
  const rows = new Map<string, TestPointRow>();
  for (const c of sorted) {
    const key = [c.sheet, c.module, c.subModule, c.testPoint].join('\u0001');
    const row = rows.get(key);
    if (row) {
      row.codes.push(c.code);
    } else {
      rows.set(key, {
        sheet: c.sheet,
        module: c.module,
        subModule: c.subModule,
        testPoint: c.testPoint,
        codes: [c.code],
      });
    }
  }
  return [...rows.values()];
}

/** 概览里一个工作表的统计：用例数、各优先级条数、各结果条数 */
export interface TestSheetStats {
  sheet: string;
  total: number;
  priority: Record<string, number>;
  result: Partial<Record<TestResult, number>>;
}

/** 按工作表统计用例数、优先级与结果分布（「概览」工作表） */
export function sheetStats(cases: TestCaseLike[], sheetOrder: string[]): TestSheetStats[] {
  return sheetOrder.map((sheet) => {
    const list = cases.filter((c) => c.sheet === sheet);
    const priority: Record<string, number> = {};
    const result: Partial<Record<TestResult, number>> = {};
    for (const c of list) {
      priority[c.priority] = (priority[c.priority] ?? 0) + 1;
      const r = c.result as TestResult;
      result[r] = (result[r] ?? 0) + 1;
    }
    return { sheet, total: list.length, priority, result };
  });
}
