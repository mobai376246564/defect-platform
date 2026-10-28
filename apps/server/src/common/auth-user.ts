import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

/** 已通过鉴权的调用方。via=token 表示个人 API Token（MCP / 脚本）。 */
export interface AuthUser {
  id: string;
  username: string;
  email: string | null;
  name: string;
  isSystemAdmin: boolean;
  via: 'jwt' | 'token';
  readOnly: boolean;
}

export type AuthedRequest = Request & { user?: AuthUser };

export const IS_PUBLIC = 'isPublic';
/** 标记无需登录的接口（登录、健康检查、APP 提单、Git Webhook、本地存储签名链接等）。 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.user) throw new Error('CurrentUser used on a public route');
  return req.user;
});
