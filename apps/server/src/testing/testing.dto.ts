import {
  inferTestCaseMode,
  TEST_PRIORITIES,
  TEST_RESULT,
  testModeFromLabel,
  testResultFromLabel,
  type TestCaseMode,
  type TestResult,
} from '@defect/shared';
import { z } from 'zod';

/** 长文本：Claude 可能传数组（每步一条），统一成多行文本；步骤数组自动加序号 */
const text = (max: number, numbered = false) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((v) =>
      Array.isArray(v)
        ? v
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s, i) => (numbered && !/^\d+[.、]/.test(s) ? `${i + 1}. ${s}` : s))
            .join('\n')
        : v,
    )
    .pipe(z.string().max(max));

/** 执行方式：auto / manual 或 自动 / 人工 */
const modeSchema = z.string().transform((v, ctx): TestCaseMode => {
  const mode = testModeFromLabel(v);
  if (mode) return mode;
  ctx.addIssue({ code: 'custom', message: '执行方式只能是 自动 / 人工（auto / manual）' });
  return z.NEVER;
});

/** 测试结果：key 或中文标签 */
const resultSchema = z.string().transform((v): TestResult => {
  if ((Object.keys(TEST_RESULT) as string[]).includes(v)) return v as TestResult;
  return testResultFromLabel(v);
});

const caseFields = {
  code: z.string().trim().min(1).max(30),
  module: z.string().trim().max(60),
  subModule: z.string().trim().max(60),
  testPoint: z.string().trim().max(60),
  title: z.string().trim().min(1).max(200),
  priority: z.enum(TEST_PRIORITIES),
  caseType: z.string().trim().max(10),
  precondition: text(2000),
  steps: text(5000, true),
  expected: text(5000),
  actualResult: text(5000),
  result: resultSchema,
  remark: text(2000),
  mode: modeSchema,
};

/**
 * 新建用例（Claude 生成或导入）。执行方式没写时按用例类型推断（硬件、服务端类为人工）。
 */
export const caseInputSchema = z
  .object({
    ...caseFields,
    module: caseFields.module.default(''),
    subModule: caseFields.subModule.default(''),
    testPoint: caseFields.testPoint.default(''),
    priority: caseFields.priority.default('P2'),
    caseType: caseFields.caseType.default('功能'),
    precondition: caseFields.precondition.default(''),
    steps: caseFields.steps.default(''),
    expected: caseFields.expected.default(''),
    actualResult: caseFields.actualResult.default(''),
    result: caseFields.result.default('pending'),
    remark: caseFields.remark.default(''),
    mode: caseFields.mode.optional(),
  })
  .transform((c) => ({ ...c, mode: c.mode ?? inferTestCaseMode(c.caseType) }));
export type CaseInput = z.output<typeof caseInputSchema>;

/**
 * 修改用例：只改传了的字段（不能用 partial()——zod 4 的 partial 仍会套默认值，没传的字段会被重置）。
 * defectCode 传空串解除关联。
 */
export const casePatchSchema = z
  .object({
    ...caseFields,
    defectCode: z
      .string()
      .trim()
      .regex(/^([A-Z][A-Z0-9]{1,9}-\d+)?$/, '缺陷编号形如 APP-1024'),
  })
  .partial();
export type CasePatch = z.output<typeof casePatchSchema>;

const sheetSchema = z.object({
  name: z.string().trim().min(1).max(31, 'Excel 工作表名最多 31 个字'),
  module: z.string().trim().max(60).default(''),
});

const questionSchema = z.object({
  module: z.string().trim().max(60).default(''),
  question: z.string().trim().min(1).max(2000),
  answer: z.string().max(2000).default(''),
  confirmer: z.string().max(60).default(''),
});
export type QuestionInput = z.output<typeof questionSchema>;

/** 带工作表名的用例（一次创建整份文件时用） */
const sheetCaseSchema = z.object({ sheet: z.string().trim().min(1).max(31) }).and(caseInputSchema);

/** 新建用例文件（Claude 生成或 Excel 导入解析后） */
export const suiteCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  docName: z.string().trim().max(100).default(''),
  source: z.string().trim().max(1000).default(''),
  notes: z.array(z.string().max(500)).max(30).optional(),
  sheets: z.array(sheetSchema).min(1).max(50),
  cases: z.array(sheetCaseSchema).max(3000).default([]),
  questions: z.array(questionSchema).max(500).default([]),
});
export type SuiteCreateInput = z.output<typeof suiteCreateSchema>;

export const suitePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    docName: z.string().trim().max(100),
    source: z.string().trim().max(1000),
    notes: z.array(z.string().max(500)).max(30),
  })
  .partial();
export type SuitePatch = z.output<typeof suitePatchSchema>;

/** 往一个工作表追加用例（Claude 分批写入；工作表不存在时自动新建） */
export const addCasesSchema = z.object({
  sheet: z.string().trim().min(1).max(31),
  module: z.string().trim().max(60).optional(),
  cases: z.array(caseInputSchema).min(1).max(200),
});
export type AddCasesInput = z.output<typeof addCasesSchema>;

export const addQuestionsSchema = z.object({
  questions: z.array(questionSchema).min(1).max(200),
});

export const questionPatchSchema = z
  .object({
    module: z.string().trim().max(60),
    question: z.string().trim().min(1).max(2000),
    answer: z.string().max(2000),
    confirmer: z.string().max(60),
  })
  .partial();
export type QuestionPatch = z.output<typeof questionPatchSchema>;
