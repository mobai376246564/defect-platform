import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { POSITIONS } from '@defect/shared';
import { z } from 'zod';
import { CurrentUser, Public, type AuthUser } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService, passwordSchema, usernameSchema } from './auth.service';

/** account 为账号或邮箱；兼容旧客户端的 { email, password }。 */
const loginSchema = z.preprocess(
  (v) =>
    v && typeof v === 'object' && !('account' in v) && 'email' in v
      ? { ...v, account: (v as { email: unknown }).email }
      : v,
  z.object({
    account: z.string().trim().min(1, '请输入账号').max(254),
    password: z.string().min(1),
  }),
);

const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  position: z.enum(POSITIONS),
  name: z.string().trim().max(50).optional(),
});

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: passwordSchema,
});

const createTokenSchema = z.object({
  name: z.string().trim().min(1).max(50),
  readOnly: z.boolean().default(false),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>) {
    return this.auth.login(body.account, body.password);
  }

  /** 自助注册，账号需系统管理员审核通过后才能登录。 */
  @Public()
  @Post('register')
  register(@Body(new ZodPipe(registerSchema)) body: z.infer<typeof registerSchema>) {
    return this.auth.register(body);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  /** 修改自己的密码。只允许登录会话调用，个人 API Token（MCP / 脚本）不能改密码。 */
  @Post('password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>,
  ): Promise<void> {
    if (user.via !== 'jwt') throw new ForbiddenException('请登录后在个人设置中修改密码');
    await this.auth.changePassword(user.id, body.oldPassword, body.newPassword);
  }

  /** 个人 API Token：供本地 Claude Code 通过 MCP 访问平台。明文只在创建时返回一次。 */
  @Get('tokens')
  listTokens(@CurrentUser() user: AuthUser) {
    return this.auth.listApiTokens(user.id);
  }

  @Post('tokens')
  createToken(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createTokenSchema)) body: z.infer<typeof createTokenSchema>,
  ) {
    return this.auth.createApiToken(user.id, body);
  }

  @Delete('tokens/:id')
  @HttpCode(204)
  async revokeToken(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.auth.revokeApiToken(user.id, id);
  }
}
