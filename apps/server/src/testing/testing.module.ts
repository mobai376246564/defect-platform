import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { ProjectsModule } from '../projects/projects.module';
import { TestingController } from './testing.controller';
import { TestingService } from './testing.service';

/** 用例 Excel 上传上限：几百条用例的文件通常不到 1 MB */
const EXCEL_MAX_BYTES = 10 * 1024 * 1024;

/** 自动化测试：用例文件（MCP 工具也复用 TestingService） */
@Module({
  imports: [
    ProjectsModule,
    // 只收一个 Excel；不设 dest / storage 时 multer 放在内存里，直接解析，不落临时文件
    MulterModule.register({
      limits: { fileSize: EXCEL_MAX_BYTES, files: 1 },
      defParamCharset: 'utf8',
    } as never),
  ],
  controllers: [TestingController],
  providers: [TestingService],
  exports: [TestingService],
})
export class TestingModule {}
