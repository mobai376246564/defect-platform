import { Module } from '@nestjs/common';
import { CleanupService } from './cleanup.service';

/** 定期维护：每日清理过期文件与记录 */
@Module({
  providers: [CleanupService],
  exports: [CleanupService],
})
export class MaintenanceModule {}
