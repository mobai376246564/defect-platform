import { BadRequestException, Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { isAllowedAttachment } from '@defect/shared';
import { DefectsModule } from '../defects/defects.module';
import { PrismaService } from '../prisma/prisma.service';
import { IngestController } from './ingest.controller';
import { APP_FILE_MAX_BYTES, APP_MAX_FILES, IngestService } from './ingest.service';
import { APP_UPLOAD_DIR } from './upload-dir';

/**
 * APP 提单的上传设置。每个文件开始接收时就检查类型，以及（文本字段在文件之前时）APP 标识是否已绑定，
 * 不合格的立即中止请求，不先把几百 MB 写进临时目录。
 */
function uploadOptions(prisma: PrismaService): MulterOptions {
  return {
    dest: APP_UPLOAD_DIR,
    limits: {
      fileSize: APP_FILE_MAX_BYTES,
      files: APP_MAX_FILES,
      fieldSize: 1024 * 1024,
      fields: 40,
      parts: 60,
    },
    fileFilter: (req, file, cb) => {
      if (!isAllowedAttachment(file.originalname)) {
        cb(new BadRequestException(`不支持的文件类型：${file.originalname}`), false);
        return;
      }
      const appId = (req.body as { appId?: unknown } | undefined)?.appId;
      if (typeof appId !== 'string' || !appId.trim()) {
        cb(null, true);
        return;
      }
      prisma.project
        .count({ where: { appIds: { has: appId.trim() } } })
        .then((n) =>
          n > 0
            ? cb(null, true)
            : cb(
                new BadRequestException(
                  `APP 标识 ${appId.trim()} 还没有绑定到任何项目，请联系平台管理员在「项目设置 → APP 接入」中绑定`,
                ),
                false,
              ),
        )
        .catch((err: Error) => cb(err, false));
    },
    // 文件名按 UTF-8 解析，中文文件名不乱码
    defParamCharset: 'utf8',
  } as MulterOptions;
}

@Module({
  imports: [
    DefectsModule,
    MulterModule.registerAsync({ useFactory: uploadOptions, inject: [PrismaService] }),
  ],
  controllers: [IngestController],
  providers: [IngestService],
})
export class IngestModule {}
