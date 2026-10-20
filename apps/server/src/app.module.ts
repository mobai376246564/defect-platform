import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AttachmentsModule } from './attachments/attachments.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { APP_ENV, type AppEnv } from './config/env';
import { DefectsModule } from './defects/defects.module';
import { GitWebhooksModule } from './git-webhooks/git-webhooks.module';
import { HealthController } from './health/health.controller';
import { IngestModule } from './ingest/ingest.module';
import { JobsModule } from './jobs/jobs.module';
import { McpModule } from './mcp/mcp.module';
import { MediaModule } from './media/media.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsModule } from './projects/projects.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { ReportsModule } from './reports/reports.module';
import { StorageModule } from './storage/storage.module';
import { SystemModule } from './system/system.module';
import { UsersController } from './users/users.controller';
import { ViewsModule } from './views/views.module';

@Module({
  imports: [
    ConfigModule,
    // 按 IP 限流（部署在 nginx 后面时依赖 trust proxy 取到真实 IP）：全局兜底，登录 / 注册另有更严的上限
    ThrottlerModule.forRootAsync({
      inject: [APP_ENV],
      useFactory: (env: AppEnv) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: env.RATE_LIMIT_PER_MINUTE }],
        skipIf: () => env.NODE_ENV === 'test',
      }),
    }),
    PrismaModule,
    StorageModule,
    JobsModule,
    AuthModule,
    ProjectsModule,
    DefectsModule,
    AttachmentsModule,
    IngestModule,
    MediaModule,
    McpModule,
    GitWebhooksModule,
    NotificationsModule,
    ReportsModule,
    MaintenanceModule,
    ViewsModule,
    SystemModule,
  ],
  controllers: [HealthController, UsersController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
