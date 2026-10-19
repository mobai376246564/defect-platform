import { Module } from '@nestjs/common';
import { DefectsModule } from '../defects/defects.module';
import { ProjectsModule } from '../projects/projects.module';
import { AttachmentsController } from './attachments.controller';

@Module({
  imports: [ProjectsModule, DefectsModule],
  controllers: [AttachmentsController],
})
export class AttachmentsModule {}
