import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProjectsModule } from '../projects/projects.module';
import { DefectBulkService } from './defect-bulk.service';
import { DefectsController } from './defects.controller';
import { DefectsService } from './defects.service';
import { TodosController } from './todos.controller';

@Module({
  imports: [ProjectsModule, NotificationsModule],
  controllers: [DefectsController, TodosController],
  providers: [DefectsService, DefectBulkService],
  exports: [DefectsService],
})
export class DefectsModule {}
