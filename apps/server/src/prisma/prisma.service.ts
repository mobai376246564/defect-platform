import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { APP_ENV, type AppEnv } from '../config/env';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_ENV) env: AppEnv) {
    super({
      adapter: new PrismaPg({
        connectionString: env.DATABASE_URL,
        max: env.DB_POOL_MAX,
        // 连接池满时最多等 10 秒就报错，而不是无限等待；空闲连接 30 秒后释放
        connectionTimeoutMillis: 10_000,
        idleTimeoutMillis: 30_000,
        // 单条 SQL 超时：一个慢查询不会一直占着连接拖垮整个服务（0 表示不限制）
        statement_timeout: env.DB_STATEMENT_TIMEOUT_MS || undefined,
      }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
