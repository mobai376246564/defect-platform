import { Module } from '@nestjs/common';
import { SystemUpdateService } from './system-update.service';
import { SystemController } from './system.controller';

@Module({
  controllers: [SystemController],
  providers: [SystemUpdateService],
})
export class SystemModule {}
