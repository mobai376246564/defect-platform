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
import { z } from 'zod';
import { AuthService, passwordSchema } from '../auth/auth.service';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

const createUserSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  name: z.string().trim().min(1).max(50),
  password: passwordSchema,
  isSystemAdmin: z.boolean().default(false),
});

const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  isSystemAdmin: z.boolean().optional(),
  disabled: z.boolean().optional(),
});

const resetPasswordSchema = z.object({ password: passwordSchema });

const userSelect = {
  id: true,
  email: true,
  name: true,
  isSystemAdmin: true,
  disabledAt: true,
  createdAt: true,
} as const;

/** 系统用户管理。MVP 用本地账号，企业微信 / 飞书 SSO 在后续迭代接入。 */
@Controller('admin/users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    this.requireAdmin(user);
    return this.prisma.user.findMany({ select: userSelect, orderBy: { createdAt: 'asc' } });
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createUserSchema)) body: z.infer<typeof createUserSchema>,
  ) {
    this.requireAdmin(user);
    const exists = await this.prisma.user.findUnique({ where: { email: body.email } });
    if (exists) throw new ConflictException('邮箱已被使用');
    const created = await this.prisma.user.create({
      data: {
        email: body.email,
        name: body.name,
        isSystemAdmin: body.isSystemAdmin,
        passwordHash: await AuthService.hashPassword(body.password),
      },
    });
    return { id: created.id, email: created.email, name: created.name };
  }

  /** 修改姓名、系统管理员身份、禁用 / 启用。不能降级或禁用自己，保证系统里始终有管理员。 */
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
      data: { name: body.name, isSystemAdmin: body.isSystemAdmin, disabledAt },
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
