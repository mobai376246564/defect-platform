import { Module } from '@nestjs/common';
import { DefectsModule } from '../defects/defects.module';
import { GitWebhooksController } from './git-webhooks.controller';
import { GitWebhooksService } from './git-webhooks.service';

@Module({
  imports: [DefectsModule],
  controllers: [GitWebhooksController],
  providers: [GitWebhooksService],
})
export class GitWebhooksModule {}
