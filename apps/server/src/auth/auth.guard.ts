import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC, type AuthedRequest } from '../common/auth-user';
import { AuthService } from './auth.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** 全局鉴权：除 @Public() 接口外都需要 Bearer 凭证；只读 Token 只能调用读接口。 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? '';
    const [scheme, credential] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !credential) {
      throw new UnauthorizedException('未登录');
    }
    const user = await this.auth.authenticate(credential);
    if (!user) throw new UnauthorizedException('登录已失效');
    // MCP 端点自行按工具区分读写，这里只拦截 REST 写操作
    if (user.readOnly && !SAFE_METHODS.has(req.method) && !req.path.endsWith('/mcp')) {
      throw new ForbiddenException('只读 Token 不能执行写操作');
    }
    req.user = user;
    return true;
  }
}
