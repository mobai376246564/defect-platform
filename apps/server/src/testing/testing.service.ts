import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { sheetStats, type TestResult } from '@defect/shared';
import type { AuthUser } from '../common/auth-user';
import type { Prisma, TestCase, TestSuite } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ProjectContext } from '../projects/project-access.service';
import { buildSuiteWorkbook, parseSuiteWorkbook } from './suite-excel';
import {
  caseInputSchema,
  suiteCreateSchema,
  type AddCasesInput,
  type CaseInput,
  type CasePatch,
  type QuestionInput,
  type QuestionPatch,
  type SuiteCreateInput,
  type SuitePatch,
} from './testing.dto';

export interface SuiteSheet {
  name: string;
  module: string;
}

const sheetsOf = (suite: Pick<TestSuite, 'sheets'>) => suite.sheets as unknown as SuiteSheet[];

/** 用例按工作表顺序、表内顺序排列 */
function orderCases<T extends Pick<TestCase, 'sheet' | 'sortOrder'>>(
  cases: T[],
  sheets: SuiteSheet[],
) {
  const rank = new Map(sheets.map((s, i) => [s.name, i]));
  return [...cases].sort(
    (a, b) => (rank.get(a.sheet) ?? 999) - (rank.get(b.sheet) ?? 999) || a.sortOrder - b.sortOrder,
  );
}

/** 各结果的条数 */
function resultCounts(cases: { result: string }[]): Partial<Record<TestResult, number>> {
  const out: Partial<Record<TestResult, number>> = {};
  for (const c of cases) out[c.result as TestResult] = (out[c.result as TestResult] ?? 0) + 1;
  return out;
}

/** 同一文件里重复的用例编号 */
function duplicateCodes(codes: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const c of codes) {
    if (seen.has(c)) dup.add(c);
    seen.add(c);
  }
  return [...dup];
}

/**
 * 自动化测试的用例文件：一份需求文档一个文件，结构与团队的 Excel 用例表一致。
 * 用例的测试结果直接记在用例上（当前轮次）；「开始新一轮」时把本轮结果存档到 TestRound 并清空。
 */
@Injectable()
export class TestingService {
  constructor(private readonly prisma: PrismaService) {}

  /** 用例文件列表，附用例数与各结果条数（进度） */
  async listSuites(ctx: ProjectContext) {
    const suites = await this.prisma.testSuite.findMany({
      where: { projectId: ctx.project.id },
      orderBy: { createdAt: 'desc' },
    });
    const counts = await this.prisma.testCase.groupBy({
      by: ['suiteId', 'result'],
      where: { suiteId: { in: suites.map((s) => s.id) } },
      _count: { _all: true },
    });
    const names = await this.userNames(suites.map((s) => s.createdById));
    return suites.map((s) => {
      const stats: Partial<Record<TestResult, number>> = {};
      let total = 0;
      for (const c of counts) {
        if (c.suiteId !== s.id) continue;
        stats[c.result as TestResult] = c._count._all;
        total += c._count._all;
      }
      return {
        id: s.id,
        seq: s.seq,
        name: s.name,
        docName: s.docName,
        source: s.source,
        round: s.round,
        sheetCount: sheetsOf(s).length,
        total,
        stats,
        createdByName: s.createdById ? (names.get(s.createdById) ?? null) : null,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      };
    });
  }

  /** 整份用例文件：工作表、全部用例（按顺序）、需求待确认、历史轮次概要 */
  async getSuite(ctx: ProjectContext, id: string) {
    const suite = await this.findSuite(ctx, id);
    const [cases, questions, rounds] = await Promise.all([
      this.prisma.testCase.findMany({ where: { suiteId: id } }),
      this.prisma.testQuestion.findMany({ where: { suiteId: id }, orderBy: { seq: 'asc' } }),
      this.prisma.testRound.findMany({
        where: { suiteId: id },
        orderBy: { round: 'desc' },
        select: { id: true, round: true, stats: true, finishedAt: true, finishedById: true },
      }),
    ]);
    const names = await this.userNames([
      ...cases.map((c) => c.executedById),
      ...rounds.map((r) => r.finishedById),
    ]);
    return {
      ...suite,
      sheets: sheetsOf(suite),
      cases: orderCases(cases, sheetsOf(suite)).map((c) => ({
        ...c,
        executedByName: c.executedById ? (names.get(c.executedById) ?? null) : null,
      })),
      questions,
      rounds: rounds.map((r) => ({
        ...r,
        finishedByName: r.finishedById ? (names.get(r.finishedById) ?? null) : null,
      })),
    };
  }

  /**
   * 新建用例文件（Claude 生成或 Excel 导入）。用例一律视为已审核，直接可执行。
   * 用例所在工作表不在 sheets 里时报错；同一文件内用例编号不能重复。
   */
  async createSuite(ctx: ProjectContext, user: AuthUser, input: SuiteCreateInput) {
    const sheetNames = new Set(input.sheets.map((s) => s.name));
    if (sheetNames.size !== input.sheets.length) throw new BadRequestException('工作表名重复');
    const unknown = [...new Set(input.cases.map((c) => c.sheet))].filter((s) => !sheetNames.has(s));
    if (unknown.length) throw new BadRequestException(`用例的工作表不存在：${unknown.join('、')}`);
    const dup = duplicateCodes(input.cases.map((c) => c.code));
    if (dup.length) throw new BadRequestException(`用例编号重复：${dup.slice(0, 10).join('、')}`);

    // 每个工作表内按出现顺序编排
    const order = new Map<string, number>();
    const rows = input.cases.map((c) => {
      const sortOrder = (order.get(c.sheet) ?? 0) + 1;
      order.set(c.sheet, sortOrder);
      return { ...c, sortOrder };
    });

    return this.prisma.$transaction(async (tx) => {
      const { testSuiteSeq } = await tx.project.update({
        where: { id: ctx.project.id },
        data: { testSuiteSeq: { increment: 1 } },
        select: { testSuiteSeq: true },
      });
      const suite = await tx.testSuite.create({
        data: {
          projectId: ctx.project.id,
          seq: testSuiteSeq,
          name: input.name,
          docName: input.docName,
          source: input.source,
          notes: input.notes ?? [],
          sheets: input.sheets.map((s) => ({ name: s.name, module: s.module || s.name })),
          createdById: user.id,
        },
      });
      if (rows.length) {
        await tx.testCase.createMany({ data: rows.map((c) => ({ ...c, suiteId: suite.id })) });
      }
      if (input.questions.length) {
        await tx.testQuestion.createMany({
          data: input.questions.map((q, i) => ({ ...q, suiteId: suite.id, seq: i + 1 })),
        });
      }
      return { id: suite.id, seq: suite.seq, name: suite.name, total: rows.length };
    });
  }

  /**
   * 导入团队格式的 Excel 为一个新的用例文件。
   * @param fileName 上传的文件名（概览里没有标题时用作文件名）
   */
  async importExcel(ctx: ProjectContext, user: AuthUser, buffer: Buffer, fileName: string) {
    let parsed;
    try {
      parsed = await parseSuiteWorkbook(buffer, fileName);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    const checked = suiteCreateSchema.safeParse(parsed);
    if (!checked.success) {
      const issue = checked.error.issues[0];
      // 定位到具体的工作表和用例，方便在 Excel 里改
      const at = issue.path[0] === 'cases' ? parsed.cases[Number(issue.path[1])] : undefined;
      const where = at ? `「${at.sheet}」${at.code || at.title}：` : '';
      throw new BadRequestException(
        `${where}${issue.path.slice(2).join('.')} ${issue.message}`.trim(),
      );
    }
    return this.createSuite(ctx, user, checked.data);
  }

  /** 导出为与团队用例表结构一致的 Excel */
  async exportExcel(ctx: ProjectContext, id: string): Promise<{ name: string; buffer: Buffer }> {
    const suite = await this.getSuite(ctx, id);
    const buffer = await buildSuiteWorkbook({
      name: suite.name,
      docName: suite.docName,
      source: suite.source,
      notes: suite.notes,
      sheets: suite.sheets,
      cases: suite.cases.map((c) => ({
        ...c,
        result: c.result as TestResult,
        mode: c.mode as 'auto' | 'manual',
      })),
      questions: suite.questions,
    });
    return { name: suite.name, buffer };
  }

  async updateSuite(ctx: ProjectContext, id: string, patch: SuitePatch) {
    await this.findSuite(ctx, id);
    return this.prisma.testSuite.update({ where: { id }, data: patch });
  }

  async deleteSuite(ctx: ProjectContext, id: string): Promise<void> {
    await this.findSuite(ctx, id);
    await this.prisma.testSuite.delete({ where: { id } });
  }

  /**
   * 往一个工作表追加用例（Claude 分批写入）。工作表不存在时追加到末尾。
   * @returns 追加后该工作表的用例数
   */
  async addCases(ctx: ProjectContext, id: string, input: AddCasesInput) {
    const suite = await this.findSuite(ctx, id);
    const sheets = sheetsOf(suite);
    if (!sheets.some((s) => s.name === input.sheet)) {
      sheets.push({
        name: input.sheet,
        module: input.module || input.cases[0].module || input.sheet,
      });
      await this.prisma.testSuite.update({ where: { id }, data: { sheets: sheets as never } });
    }
    const existing = await this.prisma.testCase.findMany({
      where: { suiteId: id },
      select: { code: true, sheet: true, sortOrder: true },
    });
    const dup = duplicateCodes([...existing.map((c) => c.code), ...input.cases.map((c) => c.code)]);
    if (dup.length) throw new BadRequestException(`用例编号重复：${dup.slice(0, 10).join('、')}`);
    const start = Math.max(
      0,
      ...existing.filter((c) => c.sheet === input.sheet).map((c) => c.sortOrder),
    );
    await this.prisma.testCase.createMany({
      data: input.cases.map((c: CaseInput, i) => ({
        ...c,
        suiteId: id,
        sheet: input.sheet,
        sortOrder: start + i + 1,
      })),
    });
    return { sheet: input.sheet, added: input.cases.length, total: start + input.cases.length };
  }

  /** 新增一条用例（网页上手动加） */
  async createCase(ctx: ProjectContext, id: string, sheet: string, input: unknown) {
    const parsed = caseInputSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message);
    return this.addCases(ctx, id, { sheet, cases: [parsed.data] });
  }

  /**
   * 修改一条用例。改测试结果时记下执行人与时间（改回未执行则清空）。
   * @param executor manual 人工（网页）/ ai Claude（MCP）
   */
  async updateCase(
    ctx: ProjectContext,
    user: AuthUser,
    suiteId: string,
    caseId: string,
    patch: CasePatch,
    executor: 'manual' | 'ai',
  ) {
    await this.findSuite(ctx, suiteId);
    const current = await this.prisma.testCase.findFirst({ where: { id: caseId, suiteId } });
    if (!current) throw new NotFoundException('用例不存在');

    const { defectCode, ...fields } = patch;
    const data: Prisma.TestCaseUpdateInput = { ...fields };
    if (fields.code && fields.code !== current.code) {
      const clash = await this.prisma.testCase.findFirst({ where: { suiteId, code: fields.code } });
      if (clash) throw new BadRequestException(`用例编号 ${fields.code} 已存在`);
    }
    if (fields.result !== undefined && fields.result !== current.result) {
      const executed = fields.result !== 'pending';
      data.executor = executed ? executor : null;
      data.executedById = executed ? user.id : null;
      data.executedAt = executed ? new Date() : null;
    }
    if (defectCode !== undefined) {
      if (defectCode === '') {
        data.defectId = null;
        data.defectCode = null;
      } else {
        const defect = await this.prisma.defect.findFirst({
          where: { projectId: ctx.project.id, code: defectCode, deletedAt: null },
          select: { id: true, code: true },
        });
        if (!defect) throw new BadRequestException(`本项目没有缺陷 ${defectCode}`);
        data.defectId = defect.id;
        data.defectCode = defect.code;
      }
    }
    return this.prisma.testCase.update({ where: { id: caseId }, data });
  }

  async deleteCase(ctx: ProjectContext, suiteId: string, caseId: string): Promise<void> {
    await this.findSuite(ctx, suiteId);
    const { count } = await this.prisma.testCase.deleteMany({ where: { id: caseId, suiteId } });
    if (count === 0) throw new NotFoundException('用例不存在');
  }

  /** 追加需求待确认的问题，序号接着往后排 */
  async addQuestions(ctx: ProjectContext, suiteId: string, questions: QuestionInput[]) {
    await this.findSuite(ctx, suiteId);
    const last = await this.prisma.testQuestion.findFirst({
      where: { suiteId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    const start = last?.seq ?? 0;
    await this.prisma.testQuestion.createMany({
      data: questions.map((q, i) => ({ ...q, suiteId, seq: start + i + 1 })),
    });
    return { added: questions.length, total: start + questions.length };
  }

  async updateQuestion(ctx: ProjectContext, suiteId: string, id: string, patch: QuestionPatch) {
    await this.findSuite(ctx, suiteId);
    const q = await this.prisma.testQuestion.findFirst({ where: { id, suiteId } });
    if (!q) throw new NotFoundException('问题不存在');
    return this.prisma.testQuestion.update({ where: { id }, data: patch });
  }

  /**
   * 结束本轮、开始新一轮：把每条用例的结果存档到 TestRound，然后清空测试结果、实际结果与关联缺陷。
   */
  async newRound(ctx: ProjectContext, user: AuthUser, suiteId: string) {
    const suite = await this.findSuite(ctx, suiteId);
    const cases = orderCases(
      await this.prisma.testCase.findMany({ where: { suiteId } }),
      sheetsOf(suite),
    );
    return this.prisma.$transaction(async (tx) => {
      await tx.testRound.create({
        data: {
          suiteId,
          round: suite.round,
          stats: resultCounts(cases),
          results: cases.map((c) => ({
            code: c.code,
            sheet: c.sheet,
            title: c.title,
            result: c.result,
            actualResult: c.actualResult,
            remark: c.remark,
            defectCode: c.defectCode,
            executedAt: c.executedAt,
          })),
          finishedById: user.id,
        },
      });
      await tx.testCase.updateMany({
        where: { suiteId },
        data: {
          result: 'pending',
          actualResult: '',
          defectId: null,
          defectCode: null,
          executor: null,
          executedById: null,
          executedAt: null,
        },
      });
      const updated = await tx.testSuite.update({
        where: { id: suiteId },
        data: { round: { increment: 1 } },
      });
      return { round: updated.round };
    });
  }

  /** 某一轮的存档结果 */
  async getRound(ctx: ProjectContext, suiteId: string, round: number) {
    await this.findSuite(ctx, suiteId);
    const r = await this.prisma.testRound.findUnique({
      where: { suiteId_round: { suiteId, round } },
    });
    if (!r) throw new NotFoundException(`没有第 ${round} 轮的记录`);
    return r;
  }

  /** 供 Claude 查看：各工作表的用例数与优先级 / 结果分布 */
  async suiteSummary(ctx: ProjectContext, id: string) {
    const suite = await this.findSuite(ctx, id);
    const cases = await this.prisma.testCase.findMany({
      where: { suiteId: id },
      select: {
        code: true,
        sheet: true,
        module: true,
        subModule: true,
        testPoint: true,
        priority: true,
        result: true,
      },
    });
    return {
      suite,
      stats: sheetStats(
        cases,
        sheetsOf(suite).map((s) => s.name),
      ),
    };
  }

  private async findSuite(ctx: ProjectContext, id: string) {
    const suite = await this.prisma.testSuite.findFirst({
      where: { id, projectId: ctx.project.id },
    });
    if (!suite) throw new NotFoundException('用例文件不存在');
    return suite;
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
