import {
  TEST_CASE_MODE,
  TEST_CASE_STATUS,
  TEST_PRIORITIES,
  TEST_RESULT_STATUS,
  type TestCaseMode,
} from '@defect/shared';
import { z } from 'zod';

const keys = <T extends Record<string, string>>(map: T) =>
  Object.keys(map) as [keyof T & string, ...(keyof T & string)[]];

const lines = z.array(z.string().trim().min(1).max(2000)).max(50);

/** 执行方式同时接受 auto / manual 和 Claude 生成稿里的「自动」「人工」 */
const modeSchema = z
  .string()
  .trim()
  .transform((v, ctx): TestCaseMode => {
    if (v === 'auto' || v === '自动') return 'auto';
    if (v === 'manual' || v === '人工') return 'manual';
    ctx.addIssue({ code: 'custom', message: '执行方式只能是 auto / manual（自动 / 人工）' });
    return z.NEVER;
  });

/** 用例字段（不带默认值），新建与修改共用 */
const caseFields = {
  title: z.string().trim().min(1).max(200),
  module: z.string().trim().max(60),
  priority: z.enum(TEST_PRIORITIES),
  precondition: z.string().max(2000),
  steps: lines.min(1, '至少一个步骤'),
  expected: lines.min(1, '至少一条预期结果'),
  testData: z.string().max(5000),
  mode: modeSchema,
  manualReason: z.string().max(500),
  env: z.string().max(100),
  source: z.string().max(500),
  status: z.enum(keys(TEST_CASE_STATUS)),
};

/** 新建用例：除标题、步骤、预期外都有默认值 */
export const testCaseSchema = z.object({
  ...caseFields,
  module: caseFields.module.default(''),
  priority: caseFields.priority.default('P2'),
  precondition: caseFields.precondition.default(''),
  testData: caseFields.testData.default(''),
  mode: caseFields.mode.default('auto'),
  manualReason: caseFields.manualReason.default(''),
  env: caseFields.env.default(''),
  source: caseFields.source.default(''),
  status: caseFields.status.default('draft'),
});
export type TestCaseInput = z.infer<typeof testCaseSchema>;

/**
 * 修改用例：只改传了的字段。不能用 testCaseSchema.partial()——zod 4 的 partial 仍会套用默认值，
 * 没传的字段会被重置成默认值。
 */
export const testCaseUpdateSchema = z.object(caseFields).partial();
export type TestCaseUpdate = z.infer<typeof testCaseUpdateSchema>;

/**
 * 批量导入（Claude 生成稿或 JSON 文件）。兼容 POC 生成稿的字段名：pre / data。
 * 导入的用例一律为“待审核”，由测试审核后再入库。
 */
export const importCaseSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    module: z.string().trim().max(60).optional(),
    priority: z.enum(TEST_PRIORITIES).optional(),
    precondition: z.string().max(2000).optional(),
    pre: z.string().max(2000).optional(),
    steps: lines.min(1, '至少一个步骤'),
    expected: lines.min(1, '至少一条预期结果'),
    testData: z.string().max(5000).optional(),
    data: z.string().max(5000).optional(),
    mode: modeSchema.optional(),
    manualReason: z.string().max(500).optional(),
    env: z.string().max(100).optional(),
    source: z.string().max(500).optional(),
  })
  .transform((c) => ({
    title: c.title,
    module: c.module ?? '',
    priority: c.priority ?? 'P2',
    precondition: c.precondition ?? c.pre ?? '',
    steps: c.steps,
    expected: c.expected,
    testData: c.testData ?? c.data ?? '',
    mode: c.mode ?? 'auto',
    manualReason: c.manualReason ?? '',
    env: c.env ?? '',
    source: c.source ?? '',
  }));
export type ImportCase = z.output<typeof importCaseSchema>;

export const importSchema = z.object({
  /** 整批用例的来源（文档链接），单条用例没写来源时用它 */
  source: z.string().max(500).optional(),
  origin: z.enum(['ai', 'manual']).default('manual'),
  cases: z.array(importCaseSchema).min(1).max(500),
});
export type ImportInput = z.infer<typeof importSchema>;

export const caseQuerySchema = z.object({
  keyword: z.string().trim().max(100).optional(),
  module: z.string().max(60).optional(),
  status: z.enum(keys(TEST_CASE_STATUS)).optional(),
  mode: z.enum(keys(TEST_CASE_MODE)).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type CaseQuery = z.infer<typeof caseQuerySchema>;

/** 批量改状态（审核通过 / 废弃 / 退回待审核）或删除 */
export const caseBulkSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(500),
  action: z.enum(['approve', 'obsolete', 'draft', 'delete']),
});
export type CaseBulkInput = z.infer<typeof caseBulkSchema>;

export const runCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  env: z.string().trim().max(100).default(''),
  build: z.string().trim().max(200).default(''),
  caseIds: z.array(z.uuid()).min(1).max(500),
});
export type RunCreateInput = z.infer<typeof runCreateSchema>;

export const runUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  env: z.string().trim().max(100).optional(),
  build: z.string().trim().max(200).optional(),
  status: z.enum(['running', 'done']).optional(),
});
export type RunUpdateInput = z.infer<typeof runUpdateSchema>;

export const resultUpdateSchema = z.object({
  status: z.enum(keys(TEST_RESULT_STATUS)).optional(),
  note: z.string().max(10_000).optional(),
  /** 关联缺陷编号（如 APP-23）；传空串解除关联 */
  defectCode: z
    .string()
    .trim()
    .regex(/^([A-Z][A-Z0-9]{1,9}-\d+)?$/, '缺陷编号形如 APP-1024')
    .optional(),
});
export type ResultUpdateInput = z.infer<typeof resultUpdateSchema>;
