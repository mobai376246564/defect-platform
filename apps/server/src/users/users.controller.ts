import { Body, ConflictException, Controller, ForbiddenException, Get, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

const createUserSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  name: z.string().trim().min(1).max(50),
  password: z.string().min(8, '密码至少 8 位'),
  isSystemAdmin: z.boolean().default(false),
});

/** 系统用户管理。MVP 用本地账号，企业微信 / 飞书 SSO 在后续迭代接入。 */
@Controller('admin/users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    this.requireAdmin(user);
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        isSystemAdmin: true,
        disabledAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
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

  private requireAdmin(user: AuthUser): void {
    if (!user.isSystemAdmin) throw new ForbiddenException('只有系统管理员可以管理用户');
  }
}
