import { BadRequestException } from '@nestjs/common';
import {
  FILTER_FIELDS,
  GROUP_NONE,
  opsFor,
  parseSort,
  type FilterCondition,
  type FilterFieldDef,
  type GroupField,
  type SortSpec,
} from '@defect/shared';
import type { AuthUser } from '../common/auth-user';
import type { Prisma } from '../generated/prisma/client';
import type { ListQuery } from './defects.dto';

type Where = Prisma.DefectWhereInput;

/** 列表、分组统计共用的查询条件：快捷筛选 AND 组合筛选 AND 当前分组 */
export function buildDefectWhere(projectId: string, user: AuthUser, q: ListQuery): Where {
  const and: Where[] = [{ projectId, deletedAt: null }];
  if (q.status?.length) and.push({ status: { in: q.status } });
  if (q.statusCategory?.length) and.push({ statusCategory: { in: q.statusCategory } });
  if (q.severity?.length) and.push({ severity: { in: q.severity } });
  if (q.priority?.length) and.push({ priority: { in: q.priority } });
  if (q.source?.length) and.push({ source: { in: q.source } });
  if (q.owner) and.push({ ownerIds: { has: q.owner === 'me' ? user.id : q.owner } });
  if (q.reporter) and.push({ reporterId: q.reporter === 'me' ? user.id : q.reporter });
  if (q.moduleId) and.push({ moduleId: q.moduleId });
  if (q.createdFrom || q.createdTo) {
    and.push({
      createdAt: {
        ...(q.createdFrom ? { gte: new Date(q.createdFrom) } : {}),
        ...(q.createdTo ? { lte: new Date(q.createdTo) } : {}),
      },
    });
  }
  if (q.keyword) {
    and.push({
      OR: [
        { code: { equals: q.keyword.toUpperCase() } },
        { title: { contains: q.keyword, mode: 'insensitive' } },
        { description: { contains: q.keyword, mode: 'insensitive' } },
        { logSummary: { contains: q.keyword, mode: 'insensitive' } },
      ],
    });
  }
  const conditions = q.filters?.conditions ?? [];
  if (conditions.length) {
    const parts = conditions.map((c) => conditionWhere(c, user));
    and.push(q.filters!.logic === 'or' ? { OR: parts } : { AND: parts });
  }
  if (q.groupField && q.groupValue !== undefined) {
    and.push(groupWhere(q.groupField, q.groupValue, user));
  }
  return { AND: and };
}

function conditionWhere(c: FilterCondition, user: AuthUser): Where {
  const def: FilterFieldDef = FILTER_FIELDS[c.field];
  if (!opsFor(c.field).includes(c.op)) {
    throw new BadRequestException(`「${def.label}」不支持该条件`);
  }
  const f = c.field;
  const bad = (): never => {
    throw new BadRequestException(`「${def.label}」的筛选值不正确`);
  };

  if (c.op === 'empty' || c.op === 'nempty') {
    const empty: Where = def.type === 'users' ? { ownerIds: { isEmpty: true } } : { [f]: null };
    return c.op === 'empty' ? empty : { NOT: empty };
  }

  switch (def.type) {
    case 'status':
    case 'enum':
    case 'module':
    case 'version':
    case 'user':
    case 'users': {
      const raw = Array.isArray(c.value)
        ? c.value
        : typeof c.value === 'string'
          ? [c.value]
          : bad();
      const values = raw
        .filter((v): v is string => typeof v === 'string' && v !== '')
        .map((v) => (v === 'me' ? user.id : v));
      if (!values.length) bad();
      if (def.type === 'users') {
        const hit: Where = { ownerIds: { hasSome: values } };
        return c.op === 'in' ? hit : { NOT: hit };
      }
      if (c.op === 'in') return { [f]: { in: values } };
      // SQL 的 NOT IN 会把空值排除在外，“不属于”应包含未填写的缺陷
      return def.required
        ? { [f]: { notIn: values } }
        : { OR: [{ [f]: { notIn: values } }, { [f]: null }] };
    }
    case 'text': {
      if (typeof c.value !== 'string' || !c.value.trim()) bad();
      const hit: Where = { [f]: { contains: (c.value as string).trim(), mode: 'insensitive' } };
      return c.op === 'contains' ? hit : { NOT: hit };
    }
    case 'date': {
      const date = (v: unknown): Date | undefined => {
        if (v === null || v === undefined || v === '') return undefined;
        const d = new Date(String(v));
        return Number.isNaN(d.getTime()) ? bad() : d;
      };
      if (c.op === 'between') {
        if (!Array.isArray(c.value)) bad();
        const [from, to] = [date((c.value as unknown[])[0]), date((c.value as unknown[])[1])];
        if (!from && !to) bad();
        return { [f]: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } };
      }
      const d = date(c.value) ?? bad();
      return { [f]: c.op === 'gte' ? { gte: d } : { lte: d } };
    }
    case 'number': {
      const n = typeof c.value === 'number' ? c.value : Number(c.value);
      if (!Number.isFinite(n)) bad();
      return { [f]: c.op === 'eq' ? n : c.op === 'gte' ? { gte: n } : { lte: n } };
    }
  }
}

/** 分组条件；owner 分组按“处理人包含某人” */
function groupWhere(field: GroupField, value: string, user: AuthUser): Where {
  const none = value === GROUP_NONE;
  if (field === 'owner') {
    return none
      ? { ownerIds: { isEmpty: true } }
      : { ownerIds: { has: value === 'me' ? user.id : value } };
  }
  return { [field]: none ? null : value };
}

/** 排序字段到数据库列：严重程度、优先级按等级列排序，可空列的空值排在最后 */
const SORT_COLUMN: Record<SortSpec['field'], { column: string; nullable: boolean }> = {
  createdAt: { column: 'createdAt', nullable: false },
  updatedAt: { column: 'updatedAt', nullable: false },
  severity: { column: 'severityRank', nullable: false },
  priority: { column: 'priorityRank', nullable: true },
  seq: { column: 'seq', nullable: false },
  dueAt: { column: 'dueAt', nullable: true },
  resolvedAt: { column: 'resolvedAt', nullable: true },
  reopenCount: { column: 'reopenCount', nullable: false },
  dupCount: { column: 'dupCount', nullable: false },
  title: { column: 'title', nullable: false },
};

export function sortSpecs(q: Pick<ListQuery, 'sort' | 'order'>): SortSpec[] {
  // 旧写法 sort=createdAt&order=asc：单字段，方向取 order
  const text = q.sort && !q.sort.includes(':') ? `${q.sort}:${q.order ?? 'desc'}` : q.sort;
  const specs = parseSort(text);
  return specs.length ? specs : [{ field: 'createdAt', order: 'desc' }];
}

export function buildDefectOrderBy(q: Pick<ListQuery, 'sort' | 'order'>) {
  const orderBy: Prisma.DefectOrderByWithRelationInput[] = sortSpecs(q).map((s) => {
    const { column, nullable } = SORT_COLUMN[s.field];
    // 严重程度“降序”在界面上表示从严重到轻微，即等级数值升序
    const rankField = s.field === 'severity' || s.field === 'priority';
    const order = rankField ? (s.order === 'desc' ? 'asc' : 'desc') : s.order;
    return { [column]: nullable ? { sort: order, nulls: 'last' } : order };
  });
  if (!sortSpecs(q).some((s) => s.field === 'seq')) orderBy.push({ seq: 'desc' });
  return orderBy;
}
