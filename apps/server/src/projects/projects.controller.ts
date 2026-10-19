import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  PROJECT_ROLES,
  STATUS_CATEGORY,
  type ProjectRole,
  type WorkflowDefinition,
} from '@defect/shared';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { ProjectsService } from './projects.service';

const createProjectSchema = z.object({
  key: z
    .string()
    .regex(/^[A-Z][A-Z0-9]{1,9}$/, '项目标识为 2–10 位大写字母或数字，以字母开头，如 APP'),
  name: z.string().trim().min(1).max(50),
  description: z.string().max(500).optional(),
  appIds: z.array(z.string().min(1)).optional(),
});

const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  description: z.string().max(500).optional(),
  appIds: z.array(z.string().min(1)).optional(),
  repoUrl: z.url().nullable().optional(),
  defaultOwnerId: z.uuid().nullable().optional(),
  /** 当前迭代版本：MR 合并自动解决缺陷时填入修复版本 */
  fixVersionId: z.uuid().nullable().optional(),
});

const roleSchema = z.enum(PROJECT_ROLES as [string, ...string[]]);

const workflowSchema = z.object({
  initialState: z.string().min(1),
  states: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z][a-z0-9_]*$/),
        name: z.string().min(1).max(20),
        category: z.enum(Object.keys(STATUS_CATEGORY) as [string, ...string[]]),
        color: z.string().min(1),
      }),
    )
    .min(2),
  transitions: z.array(
    z.object({
      key: z.string().regex(/^[a-z][a-z0-9_]*$/),
      from: z.string(),
      to: z.string(),
      label: z.string().min(1).max(20),
      roles: z.array(roleSchema),
      requiredFields: z.array(z.string()),
      requiresComment: z.boolean().optional(),
      system: z.boolean().optional(),
      actions: z.array(z.string()).optional(),
    }),
  ),
});

/** account 为账号或邮箱（兼容旧的 email 字段）；不传 role 时按用户职位给默认角色。 */
const memberSchema = z.preprocess(
  (v) =>
    v && typeof v === 'object' && !('account' in v) && 'email' in v
      ? { ...v, account: (v as { email: unknown }).email }
      : v,
  z.object({ account: z.string().trim().min(1).max(254), role: roleSchema.optional() }),
);
const moduleSchema = z.object({
  name: z.string().trim().min(1).max(50),
  parentId: z.uuid().nullable().optional(),
  ownerId: z.uuid().nullable().optional(),
});
const moduleUpdateSchema = moduleSchema.pick({ name: true, ownerId: true }).partial();
const versionSchema = z.object({
  name: z.string().trim().min(1).max(50),
  build: z.string().max(50).optional(),
  commit: z.string().max(64).optional(),
});

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.projects.listForUser(user);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createProjectSchema)) body: z.infer<typeof createProjectSchema>,
  ) {
    return this.projects.create(user, body);
  }

  @Get(':key')
  detail(@CurrentUser() user: AuthUser, @Param('key') key: string) {
    return this.projects.detail(key, user);
  }

  /** 删除项目，需带 ?confirm=<项目标识> 二次确认 */
  @Delete(':key')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Query('confirm') confirm?: string,
  ): Promise<void> {
    await this.projects.remove(key, user, confirm);
  }

  @Patch(':key')
  update(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Body(new ZodPipe(updateProjectSchema)) body: z.infer<typeof updateProjectSchema>,
  ) {
    return this.projects.update(key, user, body);
  }

  /** 生成或重置 Git Webhook 密钥，返回 Webhook 地址与密钥明文（只显示这一次） */
  @Post(':key/webhook-secret')
  resetWebhookSecret(@CurrentUser() user: AuthUser, @Param('key') key: string) {
    return this.projects.resetWebhookSecret(key, user);
  }

  @Put(':key/workflow')
  updateWorkflow(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Body(new ZodPipe(workflowSchema)) body: z.infer<typeof workflowSchema>,
  ) {
    return this.projects.updateWorkflow(key, user, body as WorkflowDefinition);
  }

  @Post(':key/members')
  addMember(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Body(new ZodPipe(memberSchema)) body: z.infer<typeof memberSchema>,
  ) {
    return this.projects.addMember(key, user, body.account, body.role as ProjectRole | undefined);
  }

  @Delete(':key/members/:userId')
  @HttpCode(204)
  async removeMember(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.projects.removeMember(key, user, userId);
  }

  @Post(':key/modules')
  addModule(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Body(new ZodPipe(moduleSchema)) body: z.infer<typeof moduleSchema>,
  ) {
    return this.projects.addModule(key, user, body);
  }

  @Patch(':key/modules/:id')
  @HttpCode(204)
  async updateModule(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('id') id: string,
    @Body(new ZodPipe(moduleUpdateSchema)) body: z.infer<typeof moduleUpdateSchema>,
  ): Promise<void> {
    await this.projects.updateModule(key, user, id, body);
  }

  @Post(':key/versions')
  addVersion(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Body(new ZodPipe(versionSchema)) body: z.infer<typeof versionSchema>,
  ) {
    return this.projects.addVersion(key, user, body);
  }
}
