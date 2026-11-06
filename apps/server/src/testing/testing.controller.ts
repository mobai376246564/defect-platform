import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { ProjectAccessService } from '../projects/project-access.service';
import {
  caseBulkSchema,
  caseQuerySchema,
  importSchema,
  resultUpdateSchema,
  runCreateSchema,
  runUpdateSchema,
  testCaseSchema,
  testCaseUpdateSchema,
  type CaseBulkInput,
  type CaseQuery,
  type ImportInput,
  type ResultUpdateInput,
  type RunCreateInput,
  type RunUpdateInput,
  type TestCaseInput,
  type TestCaseUpdate,
} from './testing.dto';
import { TestingService } from './testing.service';

/**
 * 自动化测试接口：/projects/:key/tests/cases（用例库）、/projects/:key/tests/runs（执行记录）。
 * 查看需要 test.view；编写、审核、导入用例与录入结果需要 test.manage。
 */
@Controller('projects/:key/tests')
export class TestingController {
  constructor(
    private readonly testing: TestingService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get('cases')
  async listCases(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Query(new ZodPipe(caseQuerySchema)) query: CaseQuery,
  ) {
    return this.testing.listCases(await this.access.require(key, user, 'test.view'), query);
  }

  @Get('cases/modules')
  async caseModules(@CurrentUser() user: AuthUser, @Param('key') key: string) {
    return this.testing.caseModules(await this.access.require(key, user, 'test.view'));
  }

  @Post('cases')
  async createCase(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Body(new ZodPipe(testCaseSchema)) body: TestCaseInput,
  ) {
    const ctx = await this.access.require(key, user, 'test.manage');
    return this.testing.createCase(ctx, user, body);
  }

  @Post('cases/import')
  async importCases(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Body(new ZodPipe(importSchema)) body: ImportInput,
  ) {
    const ctx = await this.access.require(key, user, 'test.manage');
    const created = await this.testing.importCases(ctx, user, body);
    return { count: created.length, codes: created.map((c) => c.code) };
  }

  @Post('cases/bulk')
  async bulkCases(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Body(new ZodPipe(caseBulkSchema)) body: CaseBulkInput,
  ) {
    return this.testing.bulkCases(await this.access.require(key, user, 'test.manage'), body);
  }

  @Get('cases/:id')
  async getCase(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.testing.getCase(await this.access.require(key, user, 'test.view'), id);
  }

  @Patch('cases/:id')
  async updateCase(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(testCaseUpdateSchema)) body: TestCaseUpdate,
  ) {
    return this.testing.updateCase(await this.access.require(key, user, 'test.manage'), id, body);
  }

  @Get('runs')
  async listRuns(@CurrentUser() user: AuthUser, @Param('key') key: string) {
    return this.testing.listRuns(await this.access.require(key, user, 'test.view'));
  }

  @Post('runs')
  async createRun(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Body(new ZodPipe(runCreateSchema)) body: RunCreateInput,
  ) {
    const ctx = await this.access.require(key, user, 'test.manage');
    return this.testing.createRun(ctx, user, body);
  }

  @Get('runs/:id')
  async getRun(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.testing.getRun(await this.access.require(key, user, 'test.view'), id);
  }

  @Patch('runs/:id')
  async updateRun(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(runUpdateSchema)) body: RunUpdateInput,
  ) {
    return this.testing.updateRun(await this.access.require(key, user, 'test.manage'), id, body);
  }

  @Patch('runs/:id/results/:caseId')
  async updateResult(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body(new ZodPipe(resultUpdateSchema)) body: ResultUpdateInput,
  ) {
    const ctx = await this.access.require(key, user, 'test.manage');
    return this.testing.updateResult(ctx, user, id, caseId, body, 'manual');
  }
}
