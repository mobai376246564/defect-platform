import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { POSITIONS } from '@defect/shared';
import { z } from 'zod';
import { AuthService, passwordSchema, usernameSchema } from '../auth/auth.service';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

const createUserSchema = z.object({
  username: usernameSchema,
  email: z
    .email()
    .transform((e) => e.toLowerCase())
    .nullish(),
  name: z.string().trim().min(1).max(50),
  position: z.enum(POSITIONS).default('other'),
  password: passwordSchema,
  isSystemAdmin: z.boolean().default(false),
});

const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  position: z.enum(POSITIONS).optional(),
  isSystemAdmin: z.boolean().optional(),
  disabled: z.boolean().optional(),
});

const approveSchema = z.object({ isSystemAdmin: z.boolean().default(false) });

const resetPasswordSchema = z.object({ password: passwordSchema });

const userSelect = {
  id: true,
  username: true,
  email: true,
  name: true,
  position: true,
  status: true,
  isSystemAdmin: true,
  disabledAt: true,
  createdAt: true,
} as const;

/** 系统用户管理：管理员建号、审核自助注册的账号。企业微信 / 飞书 SSO 在后续迭代接入。 */
@Controller('admin/users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    this.requireAdmin(user);
    return this.prisma.user.findMany({ select: userSelect, orderBy: { createdAt: 'asc' } });
  }

  /** 待审核注册数，供导航角标显示。 */
  @Get('pending-count')
  async pendingCount(@CurrentUser() user: AuthUser) {
    this.requireAdmin(user);
    return { count: await this.prisma.user.count({ where: { status: 'pending' } }) };
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createUserSchema)) body: z.infer<typeof createUserSchema>,
  ) {
    this.requireAdmin(user);
    const keys = [body.username, ...(body.email ? [body.email] : [])];
    const exists = await this.prisma.user.findFirst({
      where: { OR: [{ username: { in: keys } }, { email: { in: keys } }] },
    });
    if (exists) throw new ConflictException('账号或邮箱已被使用');
    return this.prisma.user.create({
      data: {
        username: body.username,
        email: body.email ?? null,
        name: body.name,
        position: body.position,
        isSystemAdmin: body.isSystemAdmin,
        passwordHash: await AuthService.hashPassword(body.password),
      },
      select: userSelect,
    });
  }

  /** 修改姓名、职位、系统管理员身份、禁用 / 启用。不能降级或禁用自己，保证系统里始终有管理员。 */
  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(updateUserSchema)) body: z.infer<typeof updateUserSchema>,
  ) {
    this.requireAdmin(user);
    const target = await this.findUser(id);
    if (target.id === user.id) {
      if (body.isSystemAdmin === false) throw new BadRequestException('不能取消自己的系统管理员');
      if (body.disabled === true) throw new BadRequestException('不能禁用自己的账号');
    }
    // 禁用后登录、JWT 与个人 API Token 都会被 AuthService 拒绝；重复禁用保留原禁用时间
    const disabledAt =
      body.disabled === undefined
        ? undefined
        : body.disabled
          ? (target.disabledAt ?? new Date())
          : null;
    return this.prisma.user.update({
      where: { id },
      data: {
        name: body.name,
        position: body.position,
        isSystemAdmin: body.isSystemAdmin,
        disabledAt,
      },
      select: userSelect,
    });
  }

  /** 审核通过注册（也可用于恢复被拒绝的账号），可同时设为系统管理员。 */
  @Post(':id/approve')
  @HttpCode(200)
  async approve(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(approveSchema)) body: z.infer<typeof approveSchema>,
  ) {
    this.requireAdmin(user);
    const target = await this.findUser(id);
    if (target.status === 'active') throw new BadRequestException('该账号已是正常状态');
    return this.prisma.user.update({
      where: { id },
      data: { status: 'active', isSystemAdmin: body.isSystemAdmin },
      select: userSelect,
    });
  }

  @Post(':id/reject')
  @HttpCode(200)
  async reject(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    this.requireAdmin(user);
    const target = await this.findUser(id);
    if (target.status !== 'pending') throw new BadRequestException('只能拒绝待审核的账号');
    return this.prisma.user.update({
      where: { id },
      data: { status: 'rejected' },
      select: userSelect,
    });
  }

  /** 管理员重置他人密码（忘记密码、替换种子默认密码）。 */
  @Post(':id/password')
  @HttpCode(204)
  async resetPassword(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(resetPasswordSchema)) body: z.infer<typeof resetPasswordSchema>,
  ): Promise<void> {
    this.requireAdmin(user);
    await this.findUser(id);
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await AuthService.hashPassword(body.password) },
    });
  }

  private async findUser(id: string) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('用户不存在');
    return target;
  }

  private requireAdmin(user: AuthUser): void {
    if (!user.isSystemAdmin) throw new ForbiddenException('只有系统管理员可以管理用户');
  }
}
