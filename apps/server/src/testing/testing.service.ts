import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { testCaseCode, testRunCode, type TestResultStatus } from '@defect/shared';
import type { AuthUser } from '../common/auth-user';
import type { Prisma, TestCase } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ProjectContext } from '../projects/project-access.service';
import type {
  CaseBulkInput,
  CaseQuery,
  ImportInput,
  ResultUpdateInput,
  RunCreateInput,
  RunUpdateInput,
  TestCaseInput,
  TestCaseUpdate,
} from './testing.dto';

/** 给前端 / MCP 的用例：带上编号 TC-n */
export function presentCase(c: TestCase) {
  return { ...c, code: testCaseCode(c.seq) };
}

/** 结果里引用的用例只带列表需要的字段 */
const CASE_BRIEF = {
  id: true,
  seq: true,
  title: true,
  module: true,
  priority: true,
  mode: true,
  manualReason: true,
  precondition: true,
  steps: true,
  expected: true,
  testData: true,
  env: true,
} as const;

/** 用例编号 TC-12 → 12；不是这种格式返回 null */
export function parseCaseCode(code: string): number | null {
  const m = /^TC-(\d+)$/i.exec(code.trim());
  return m ? Number(m[1]) : null;
}

/**
 * 自动化测试的用例库与执行记录。
 * 用例由 Claude 生成（MCP save_test_cases）或测试手写 / 导入，审核后用于执行；
 * 一次执行（TestRun）为每条用例建一条结果，人工或 Claude 逐条回写。
 */
@Injectable()
export class TestingService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- 用例 ----------

  /**
   * 分页查询用例。
   * @param ctx 项目上下文
   * @param q 关键字（标题 / 模块 / 编号）、模块、状态、执行方式与分页
   */
  async listCases(ctx: ProjectContext, q: CaseQuery) {
    const where: Prisma.TestCaseWhereInput = { projectId: ctx.project.id };
    if (q.module !== undefined) where.module = q.module;
    if (q.status) where.status = q.status;
    if (q.mode) where.mode = q.mode;
    if (q.keyword) {
      const seq = parseCaseCode(q.keyword);
      where.OR = [
        { title: { contains: q.keyword, mode: 'insensitive' } },
        { module: { contains: q.keyword, mode: 'insensitive' } },
        ...(seq !== null ? [{ seq }] : []),
      ];
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.testCase.count({ where }),
      this.prisma.testCase.findMany({
        where,
        // 按编号：Claude 按需求文档顺序生成，编号顺序就是文档里的模块顺序（按模块名排会打乱）
        orderBy: { seq: 'asc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return { total, page: q.page, pageSize: q.pageSize, items: rows.map(presentCase) };
  }

  /** 项目里出现过的模块名（用于筛选下拉），附每个模块的用例数 */
  async caseModules(ctx: ProjectContext) {
    const rows = await this.prisma.testCase.groupBy({
      by: ['module'],
      where: { projectId: ctx.project.id, status: { not: 'obsolete' } },
      _count: { _all: true },
      orderBy: { module: 'asc' },
    });
    return rows.map((r) => ({ module: r.module, count: r._count._all }));
  }

  async getCase(ctx: ProjectContext, id: string) {
    const c = await this.prisma.testCase.findFirst({ where: { id, projectId: ctx.project.id } });
    if (!c) throw new NotFoundException('用例不存在');
    return presentCase(c);
  }

  async createCase(ctx: ProjectContext, user: AuthUser, input: TestCaseInput) {
    const [created] = await this.insertCases(ctx, user, [input], 'manual');
    return created;
  }

  /**
   * 批量导入用例，统一为“待审核”。
   * @returns 新建的用例（带编号）
   */
  async importCases(ctx: ProjectContext, user: AuthUser, input: ImportInput) {
    const cases = input.cases.map((c) => ({
      ...c,
      source: c.source || input.source || '',
      status: 'draft' as const,
    }));
    return this.insertCases(ctx, user, cases, input.origin);
  }

  async updateCase(ctx: ProjectContext, id: string, patch: TestCaseUpdate) {
    await this.getCase(ctx, id);
    const updated = await this.prisma.testCase.update({ where: { id }, data: patch });
    return presentCase(updated);
  }

  /**
   * 批量审核通过 / 废弃 / 退回待审核 / 删除。
   * @returns 实际处理的条数（不属于本项目的 id 忽略）
   */
  async bulkCases(ctx: ProjectContext, input: CaseBulkInput): Promise<{ count: number }> {
    const where = { id: { in: input.ids }, projectId: ctx.project.id };
    if (input.action === 'delete') {
      return this.prisma.testCase.deleteMany({ where });
    }
    const status = { approve: 'approved', obsolete: 'obsolete', draft: 'draft' }[input.action];
    return this.prisma.testCase.updateMany({ where, data: { status } });
  }

  /** 在一个事务里一次性占用 n 个编号再写入，保证编号连续且不冲突 */
  private async insertCases(
    ctx: ProjectContext,
    user: AuthUser,
    cases: (Omit<TestCaseInput, 'status'> & { status?: TestCaseInput['status'] })[],
    origin: 'ai' | 'manual',
  ) {
    const rows = await this.prisma.$transaction(async (tx) => {
      const { testCaseSeq } = await tx.project.update({
        where: { id: ctx.project.id },
        data: { testCaseSeq: { increment: cases.length } },
        select: { testCaseSeq: true },
      });
      const first = testCaseSeq - cases.length + 1;
      await tx.testCase.createMany({
        data: cases.map((c, i) => ({
          ...c,
          projectId: ctx.project.id,
          seq: first + i,
          origin,
          createdById: user.id,
        })),
      });
      return tx.testCase.findMany({
        where: { projectId: ctx.project.id, seq: { gte: first, lte: testCaseSeq } },
        orderBy: { seq: 'asc' },
      });
    });
    return rows.map(presentCase);
  }

  // ---------- 执行记录 ----------

  /** 执行记录列表，附各结果状态的条数（进度） */
  async listRuns(ctx: ProjectContext) {
    const runs = await this.prisma.testRun.findMany({
      where: { projectId: ctx.project.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const counts = await this.prisma.testCaseResult.groupBy({
      by: ['runId', 'status'],
      where: { runId: { in: runs.map((r) => r.id) } },
      _count: { _all: true },
    });
    const creators = await this.userNames(runs.map((r) => r.createdById));
    return runs.map((r) => {
      const stats: Partial<Record<TestResultStatus, number>> = {};
      for (const c of counts) {
        if (c.runId === r.id) stats[c.status as TestResultStatus] = c._count._all;
      }
      return {
        ...r,
        code: testRunCode(r.seq),
        createdByName: r.createdById ? (creators.get(r.createdById) ?? null) : null,
        stats,
      };
    });
  }

  /**
   * 新建一次执行：为每条用例建一条“未执行”的结果。已废弃的用例不能加入。
   */
  async createRun(ctx: ProjectContext, user: AuthUser, input: RunCreateInput) {
    const cases = await this.prisma.testCase.findMany({
      where: { id: { in: input.caseIds }, projectId: ctx.project.id },
      select: { id: true, status: true },
    });
    if (cases.length !== new Set(input.caseIds).size) {
      throw new BadRequestException('部分用例不存在');
    }
    if (cases.some((c) => c.status === 'obsolete')) {
      throw new BadRequestException('已废弃的用例不能加入执行');
    }
    const run = await this.prisma.$transaction(async (tx) => {
      const { testRunSeq } = await tx.project.update({
        where: { id: ctx.project.id },
        data: { testRunSeq: { increment: 1 } },
        select: { testRunSeq: true },
      });
      return tx.testRun.create({
        data: {
          projectId: ctx.project.id,
          seq: testRunSeq,
          name: input.name,
          env: input.env,
          build: input.build,
          createdById: user.id,
          results: { create: cases.map((c) => ({ caseId: c.id })) },
        },
      });
    });
    return { ...run, code: testRunCode(run.seq) };
  }

  /** 执行记录详情：结果按用例编号排序，附用例内容与执行人姓名 */
  async getRun(ctx: ProjectContext, id: string) {
    const run = await this.prisma.testRun.findFirst({
      where: { id, projectId: ctx.project.id },
      include: {
        results: { include: { testCase: { select: CASE_BRIEF } } },
      },
    });
    if (!run) throw new NotFoundException('执行记录不存在');
    const names = await this.userNames([
      run.createdById,
      ...run.results.map((r) => r.executedById),
    ]);
    const results = run.results
      .sort((a, b) => a.testCase.seq - b.testCase.seq)
      .map((r) => ({
        ...r,
        executedByName: r.executedById ? (names.get(r.executedById) ?? null) : null,
        testCase: { ...r.testCase, code: testCaseCode(r.testCase.seq) },
      }));
    return {
      ...run,
      code: testRunCode(run.seq),
      createdByName: run.createdById ? (names.get(run.createdById) ?? null) : null,
      results,
    };
  }

  async updateRun(ctx: ProjectContext, id: string, patch: RunUpdateInput) {
    const run = await this.prisma.testRun.findFirst({ where: { id, projectId: ctx.project.id } });
    if (!run) throw new NotFoundException('执行记录不存在');
    // 结束时记下结束时间，重新打开时清空；没改状态则不动
    let finishedAt: Date | null | undefined;
    if (patch.status === 'done') {
      finishedAt = new Date();
    } else if (patch.status === 'running') {
      finishedAt = null;
    }
    const updated = await this.prisma.testRun.update({
      where: { id },
      data: { ...patch, finishedAt },
    });
    return { ...updated, code: testRunCode(updated.seq) };
  }

  /**
   * 回写一条用例的结果。
   * @param executor manual 人工（网页）/ ai Claude（MCP）
   */
  async updateResult(
    ctx: ProjectContext,
    user: AuthUser,
    runId: string,
    caseId: string,
    patch: ResultUpdateInput,
    executor: 'manual' | 'ai',
  ) {
    const result = await this.prisma.testCaseResult.findFirst({
      where: { runId, caseId, run: { projectId: ctx.project.id } },
    });
    if (!result) throw new NotFoundException('执行记录里没有这条用例');

    const data: Prisma.TestCaseResultUpdateInput = {};
    if (patch.note !== undefined) data.note = patch.note;
    if (patch.status !== undefined) {
      data.status = patch.status;
      // 改回“未执行”时清掉执行人与时间
      const executed = patch.status !== 'pending';
      data.executor = executor;
      data.executedById = executed ? user.id : null;
      data.executedAt = executed ? new Date() : null;
    }
    if (patch.defectCode !== undefined) {
      if (patch.defectCode === '') {
        data.defectId = null;
        data.defectCode = null;
      } else {
        const defect = await this.prisma.defect.findFirst({
          where: { projectId: ctx.project.id, code: patch.defectCode, deletedAt: null },
          select: { id: true, code: true },
        });
        if (!defect) throw new BadRequestException(`本项目没有缺陷 ${patch.defectCode}`);
        data.defectId = defect.id;
        data.defectCode = defect.code;
      }
    }
    return this.prisma.testCaseResult.update({ where: { id: result.id }, data });
  }

  private async userNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((v): v is string => !!v))];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(users.map((u) => [u.id, u.name]));
  }
}
