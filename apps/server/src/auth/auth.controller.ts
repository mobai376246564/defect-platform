import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Public, type AuthUser } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService } from './auth.service';

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
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
    return this.auth.login(body.email, body.password);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
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
