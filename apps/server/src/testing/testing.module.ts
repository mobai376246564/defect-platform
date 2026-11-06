import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { TestingController } from './testing.controller';
import { TestingService } from './testing.service';

/** 自动化测试：用例库与执行记录（MCP 工具也复用 TestingService） */
@Module({
  imports: [ProjectsModule],
  controllers: [TestingController],
  providers: [TestingService],
  exports: [TestingService],
})
export class TestingModule {}
