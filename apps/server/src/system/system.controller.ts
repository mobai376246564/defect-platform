import { Controller, ForbiddenException, Get, HttpCode, Post } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { SystemUpdateService } from './system-update.service';

/** 系统版本与在线更新：所有登录用户可查看版本，检查与更新仅系统管理员 */
@Controller('system')
export class SystemController {
  constructor(private readonly updates: SystemUpdateService) {}

  @Get('version')
  version() {
    return this.updates.version();
  }

  @Post('version/check')
  @HttpCode(200)
  check(@CurrentUser() user: AuthUser) {
    requireAdmin(user);
    return this.updates.check();
  }

  @Get('update')
  status(@CurrentUser() user: AuthUser) {
    requireAdmin(user);
    return this.updates.status();
  }

  @Post('update')
  @HttpCode(202)
  start(@CurrentUser() user: AuthUser) {
    requireAdmin(user);
    return this.updates.start(user.username);
  }
}

function requireAdmin(user: AuthUser): void {
  if (!user.isSystemAdmin) throw new ForbiddenException('只有系统管理员可以检查和更新版本');
}
