import {
  BUG_TYPE,
  DEFECT_SOURCE,
  FILTER_FIELD_KEYS,
  FILTER_OP_LABEL,
  FREQUENCY,
  GROUP_FIELDS,
  MAX_FILTER_CONDITIONS,
  PRIORITY,
  RESOLUTION,
  ROOT_CAUSE,
  SEVERITY,
  STATUS_CATEGORY,
  type FilterField,
  type FilterOp,
  type GroupField,
} from '@defect/shared';
import { z } from 'zod';

const keysOf = <T extends Record<string, string>>(o: T) =>
  z.enum(Object.keys(o) as [keyof T & string, ...(keyof T & string)[]]);

export const severitySchema = keysOf(SEVERITY);
export const prioritySchema = keysOf(PRIORITY);
export const frequencySchema = keysOf(FREQUENCY);
export const resolutionSchema = keysOf(RESOLUTION);
export const rootCauseSchema = keysOf(ROOT_CAUSE);
export const bugTypeSchema = keysOf(BUG_TYPE);

/** 查询串里的多选：既接受 a,b 也接受重复参数 */
const multi = <T extends z.ZodType<string, string>>(item: T) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(item))
    .optional();

const filterValueSchema = z.union([
  z.string().max(200),
  z.number(),
  z.tuple([z.string().max(40).nullable(), z.string().max(40).nullable()]),
  z.array(z.string().max(100)).max(50),
]);

export const filterGroupSchema = z.object({
  logic: z.enum(['and', 'or']).default('and'),
  conditions: z
    .array(
      z.object({
        field: z.enum(FILTER_FIELD_KEYS as [FilterField, ...FilterField[]]),
        op: z.enum(Object.keys(FILTER_OP_LABEL) as [FilterOp, ...FilterOp[]]),
        value: filterValueSchema.optional(),
      }),
    )
    .max(MAX_FILTER_CONDITIONS),
});

const groupFieldSchema = z.enum(Object.keys(GROUP_FIELDS) as [GroupField, ...GroupField[]]);

export const createDefectSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().max(50_000).default(''),
  steps: z.string().max(10_000).default(''),
  expected: z.string().max(5_000).default(''),
  actual: z.string().max(5_000).default(''),
  severity: severitySchema,
  priority: prioritySchema.optional(),
  frequency: frequencySchema.optional(),
  bugType: bugTypeSchema.optional(),
  moduleId: z.uuid().optional(),
  ownerIds: z.array(z.uuid()).max(10).optional(),
  ccIds: z.array(z.uuid()).max(20).optional(),
  versionFoundId: z.uuid().optional(),
  dueAt: z.iso.datetime({ offset: true }).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});
export type CreateDefectInput = z.infer<typeof createDefectSchema>;

export const updateDefectSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().max(50_000),
    steps: z.string().max(10_000),
    expected: z.string().max(5_000),
    actual: z.string().max(5_000),
    severity: severitySchema,
    priority: prioritySchema.nullable(),
    frequency: frequencySchema.nullable(),
    bugType: bugTypeSchema.nullable(),
    rootCause: rootCauseSchema.nullable(),
    moduleId: z.uuid().nullable(),
    ownerIds: z.array(z.uuid()).max(10),
    ccIds: z.array(z.uuid()).max(20),
    versionFoundId: z.uuid().nullable(),
    dueAt: z.iso.datetime({ offset: true }).nullable(),
    customFields: z.record(z.string(), z.unknown()),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, '至少修改一个字段');
export type UpdateDefectInput = z.infer<typeof updateDefectSchema>;

/** 流转时可以顺带填写的字段（工作流的 requiredFields 从这里取值）。 */
export const transitionSchema = z.object({
  transition: z.string().min(1),
  comment: z.string().max(10_000).optional(),
  values: z
    .object({
      priority: prioritySchema,
      moduleId: z.uuid(),
      resolution: resolutionSchema,
      rootCause: rootCauseSchema,
      versionFixedId: z.uuid(),
      ownerIds: z.array(z.uuid()).max(10),
    })
    .partial()
    .default({}),
});
export type TransitionInput = z.infer<typeof transitionSchema>;

export const commentSchema = z.object({ body: z.string().trim().min(1).max(20_000) });

export const linkSchema = z.object({
  kind: z.enum(['branch', 'commit', 'mr', 'duplicate']),
  target: z.string().trim().min(1).max(500),
  state: z.string().max(30).optional(),
});
export type LinkInput = z.infer<typeof linkSchema>;

export const listQuerySchema = z.object({
  status: multi(z.string()),
  statusCategory: multi(keysOf(STATUS_CATEGORY)),
  severity: multi(severitySchema),
  priority: multi(prioritySchema),
  source: multi(keysOf(DEFECT_SOURCE)),
  /** 用户 id 或 me */
  owner: z.string().optional(),
  reporter: z.string().optional(),
  moduleId: z.uuid().optional(),
  keyword: z.string().trim().max(100).optional(),
  createdFrom: z.iso.datetime({ offset: true }).optional(),
  createdTo: z.iso.datetime({ offset: true }).optional(),
  /** 多字段排序 severity:asc,createdAt:desc；也兼容旧写法 sort=createdAt&order=desc */
  sort: z.string().max(200).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  /** 组合筛选：JSON 编码的 FilterGroup（见 @defect/shared filters.ts） */
  filters: z
    .string()
    .max(10_000)
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'filters 不是合法的 JSON' });
        return z.NEVER;
      }
    })
    .pipe(filterGroupSchema)
    .optional(),
  /** 分组浏览时只看某一组：groupField=severity&groupValue=fatal，空值组用 __none__ */
  groupField: groupFieldSchema.optional(),
  groupValue: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  /** 看板一次最多取 200 条（与批量操作上限一致） */
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export const groupsQuerySchema = listQuerySchema.extend({ groupBy: groupFieldSchema });
export type GroupsQuery = z.infer<typeof groupsQuerySchema>;

/** 批量修改：可改的字段与单个修改一致，状态按“切换到目标状态”处理 */
export const bulkChangesSchema = z
  .object({
    status: z.string().min(1),
    severity: severitySchema,
    priority: prioritySchema.nullable(),
    ownerIds: z.array(z.uuid()).max(10),
    moduleId: z.uuid().nullable(),
    bugType: bugTypeSchema.nullable(),
    versionFoundId: z.uuid().nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, '至少修改一个字段');
export type BulkChanges = z.infer<typeof bulkChangesSchema>;

/** 最多一次批量修改的缺陷数 */
export const MAX_BULK = 1000;

/**
 * 批量修改的对象：codes 为勾选的缺陷；不传 codes 时用 query（与列表接口相同的查询参数）选中全部筛选结果。
 */
export const bulkSchema = z
  .object({
    codes: z.array(z.string().min(1).max(30)).min(1).max(MAX_BULK).optional(),
    query: z.record(z.string(), z.string()).optional(),
    changes: bulkChangesSchema,
  })
  .refine((v) => v.codes || v.query, '请选择要修改的缺陷');
export type BulkInput = z.infer<typeof bulkSchema>;

/** 我的待办：跨项目列出指派给我的缺陷 */
export const todoQuerySchema = z.object({
  keyword: z.string().trim().max(100).optional(),
  project: multi(z.string()),
  statusCategory: multi(keysOf(STATUS_CATEGORY)),
  severity: multi(severitySchema),
  priority: multi(prioritySchema),
  sort: z.string().max(200).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});
export type TodoQuery = z.infer<typeof todoQuerySchema>;
