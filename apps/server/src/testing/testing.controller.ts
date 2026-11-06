import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { ProjectAccessService } from '../projects/project-access.service';
import {
  addCasesSchema,
  addQuestionsSchema,
  casePatchSchema,
  questionPatchSchema,
  suiteCreateSchema,
  suitePatchSchema,
  type AddCasesInput,
  type CasePatch,
  type QuestionInput,
  type QuestionPatch,
  type SuiteCreateInput,
  type SuitePatch,
} from './testing.dto';
import { TestingService } from './testing.service';

/** 上传的 Excel（内存存储） */
interface UploadedExcel {
  originalname: string;
  buffer: Buffer;
}

/**
 * 自动化测试接口：/projects/:key/tests/suites（用例文件）。
 * 查看需要 test.view；新建 / 导入文件、编辑用例与录入结果需要 test.manage。
 */
@Controller('projects/:key/tests/suites')
export class TestingController {
  constructor(
    private readonly testing: TestingService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Param('key') key: string) {
    return this.testing.listSuites(await this.access.require(key, user, 'test.view'));
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Body(new ZodPipe(suiteCreateSchema)) body: SuiteCreateInput,
  ) {
    const ctx = await this.access.require(key, user, 'test.manage');
    return this.testing.createSuite(ctx, user, body);
  }

  /** 上传团队格式的 .xlsx，导入为一个新的用例文件（表单字段 file） */
  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  async importExcel(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @UploadedFile() file: UploadedExcel | undefined,
  ) {
    const ctx = await this.access.require(key, user, 'test.manage');
    if (!file) throw new BadRequestException('请选择 .xlsx 文件');
    if (!/\.xlsx$/i.test(file.originalname)) throw new BadRequestException('只支持 .xlsx 文件');
    return this.testing.importExcel(ctx, user, file.buffer, file.originalname);
  }

  @Get(':id')
  async get(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.testing.getSuite(await this.access.require(key, user, 'test.view'), id);
  }

  /** 下载为 Excel（结构与团队用例表一致） */
  @Get(':id/export')
  async export(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ctx = await this.access.require(key, user, 'test.view');
    const { name, buffer } = await this.testing.exportExcel(ctx, id);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="suite.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}.xlsx`,
    });
    return new StreamableFile(buffer);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(suitePatchSchema)) body: SuitePatch,
  ) {
    return this.testing.updateSuite(await this.access.require(key, user, 'test.manage'), id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.testing.deleteSuite(await this.access.require(key, user, 'test.manage'), id);
  }

  /** 往工作表追加用例 */
  @Post(':id/cases')
  async addCases(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(addCasesSchema)) body: AddCasesInput,
  ) {
    return this.testing.addCases(await this.access.require(key, user, 'test.manage'), id, body);
  }

  @Patch(':id/cases/:caseId')
  async updateCase(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body(new ZodPipe(casePatchSchema)) body: CasePatch,
  ) {
    const ctx = await this.access.require(key, user, 'test.manage');
    return this.testing.updateCase(ctx, user, id, caseId, body, 'manual');
  }

  @Delete(':id/cases/:caseId')
  @HttpCode(204)
  async deleteCase(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('caseId', ParseUUIDPipe) caseId: string,
  ): Promise<void> {
    await this.testing.deleteCase(await this.access.require(key, user, 'test.manage'), id, caseId);
  }

  @Post(':id/questions')
  async addQuestions(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(addQuestionsSchema)) body: { questions: QuestionInput[] },
  ) {
    const ctx = await this.access.require(key, user, 'test.manage');
    return this.testing.addQuestions(ctx, id, body.questions);
  }

  @Patch(':id/questions/:qid')
  async updateQuestion(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('qid', ParseUUIDPipe) qid: string,
    @Body(new ZodPipe(questionPatchSchema)) body: QuestionPatch,
  ) {
    const ctx = await this.access.require(key, user, 'test.manage');
    return this.testing.updateQuestion(ctx, id, qid, body);
  }

  /** 结束本轮、开始新一轮：本轮结果存档后清空 */
  @Post(':id/rounds')
  async newRound(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.testing.newRound(await this.access.require(key, user, 'test.manage'), user, id);
  }

  @Get(':id/rounds/:round')
  async getRound(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('round', ParseIntPipe) round: number,
  ) {
    return this.testing.getRound(await this.access.require(key, user, 'test.view'), id, round);
  }
}
