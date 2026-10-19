import { Module } from '@nestjs/common';
import { AttachmentsModule } from './attachments/attachments.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
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
import { ReportsModule } from './reports/reports.module';
import { StorageModule } from './storage/storage.module';
import { UsersController } from './users/users.controller';
import { ViewsModule } from './views/views.module';

@Module({
  imports: [
    ConfigModule,
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
    ViewsModule,
  ],
  controllers: [HealthController, UsersController],
})
export class AppModule {}
