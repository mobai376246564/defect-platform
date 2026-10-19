import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { attachmentKindOf } from '@defect/shared';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { DefectsService } from '../defects/defects.service';
import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectAccessService } from '../projects/project-access.service';
import { OBJECT_STORAGE, safeFileName, type ObjectStorage } from '../storage/storage.types';

const ALLOWED_EXT = [
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'mp4',
  'mov',
  'webm',
  'log',
  'txt',
  'zip',
  'gz',
  'json',
  'xlog',
];
const MAX_FILE_BYTES = 200 * 1024 * 1024;

const uploadTargetSchema = z.object({
  files: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        size: z.number().int().positive().max(MAX_FILE_BYTES, '单个文件不能超过 200 MB'),
      }),
    )
    .min(1)
    .max(10),
});

const registerSchema = z.object({
  items: z
    .array(
      z.object({
        key: z.string().min(1),
        name: z.string().min(1).max(200),
        markedAtMs: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1)
    .max(10),
});

/** 网页提单的附件：先申请上传凭证直传存储，再登记到缺陷上（方案 5.4 ②，web/ 目录）。 */
@Controller('projects/:key')
export class AttachmentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly defects: DefectsService,
    private readonly media: MediaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  @Post('defects/:code/attachments/upload-target')
  async uploadTarget(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('code') code: string,
    @Body(new ZodPipe(uploadTargetSchema)) body: z.infer<typeof uploadTargetSchema>,
  ) {
    const ctx = await this.access.require(key, user, 'defect.create');
    await this.defects.findByCode(ctx.project.id, code);
    for (const f of body.files) {
      const ext = f.name.toLowerCase().split('.').pop() ?? '';
      if (!ALLOWED_EXT.includes(ext)) throw new BadRequestException(`不支持的文件类型：${f.name}`);
    }
    // 每批上传一个随机子目录，避免同名文件互相覆盖
    const prefix = `web/${key}/${code}/${randomBytes(6).toString('hex')}/`;
    return this.storage.createUploadTarget(
      prefix,
      body.files.map((f) => f.name),
      1800,
    );
  }

  @Post('defects/:code/attachments')
  async register(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('code') code: string,
    @Body(new ZodPipe(registerSchema)) body: z.infer<typeof registerSchema>,
  ) {
    const ctx = await this.access.require(key, user, 'defect.create');
    const defect = await this.defects.findByCode(ctx.project.id, code);
    const allowedPrefix = `web/${key}/${code}/`;
    const created = [];
    for (const item of body.items) {
      if (!item.key.startsWith(allowedPrefix))
        throw new BadRequestException(`附件路径不属于该缺陷：${item.key}`);
      const head = await this.storage.headObject(item.key);
      if (!head) throw new BadRequestException(`文件尚未上传完成：${item.name}`);
      created.push(
        await this.prisma.attachment.create({
          data: {
            defectId: defect.id,
            kind: attachmentKindOf(item.name),
            fileName: safeFileName(item.name),
            storageKey: item.key,
            size: head.size,
            contentType: head.contentType,
            markedAtMs: item.markedAtMs,
            createdById: user.id,
          },
        }),
      );
    }
    await this.media.enqueueFor(created);
    return created;
  }

  /** 生成 10 分钟有效的下载 / 预览地址（方案 5.2 第 5 步）。 */
  @Get('attachments/:id/url')
  async url(@CurrentUser() user: AuthUser, @Param('key') key: string, @Param('id') id: string) {
    const ctx = await this.access.require(key, user, 'defect.view');
    const attachment = await this.prisma.attachment.findFirst({
      where: { id, defect: { projectId: ctx.project.id, deletedAt: null } },
    });
    if (!attachment) throw new NotFoundException('附件不存在');
    return { url: await this.storage.presignGet(attachment.storageKey, 600), expiresIn: 600 };
  }
}
