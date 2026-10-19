import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';

/** 负载均衡（CLB）与容器编排的健康检查。 */
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{ status: 'ok' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ status: 'db_unavailable' });
    }
    return { status: 'ok' };
  }
}
