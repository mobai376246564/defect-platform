import { Inject, Injectable, Logger } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../storage/storage.types';
import { extractFrame, planFrameTimes, probeDurationSec } from './ffmpeg';

const VIDEO_FRAMES_JOB = 'video.frames';
const MAX_VIDEO_BYTES = 300 * 1024 * 1024;

/** 录屏抽关键帧（方案 7.3），结果存 derived/ 目录，供 MCP get_video_frames 返回。 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {
    this.jobs.register(VIDEO_FRAMES_JOB, (payload) => this.extract(String(payload.attachmentId)));
  }

  /** 为视频附件安排抽帧任务；非视频附件忽略。 */
  async enqueueFor(attachments: { id: string; kind: string }[]): Promise<void> {
    for (const a of attachments.filter((x) => x.kind === 'video')) {
      await this.jobs.enqueue(
        VIDEO_FRAMES_JOB,
        { attachmentId: a.id },
        { dedupeKey: `frames:${a.id}`, maxAttempts: 3 },
      );
    }
  }

  async extract(attachmentId: string): Promise<void> {
    const attachment = await this.prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!attachment || attachment.kind !== 'video') return;
    if (attachment.size > MAX_VIDEO_BYTES) {
      this.logger.warn(`视频 ${attachment.fileName} 超过 300 MB，跳过抽帧`);
      return;
    }
    const dir = await mkdtemp(path.join(tmpdir(), 'defect-frames-'));
    try {
      const input = path.join(dir, `input${path.extname(attachment.fileName) || '.mp4'}`);
      // 流式下载到临时文件，不把最大 300 MB 的录屏整个读进内存
      await this.storage.downloadToFile(attachment.storageKey, input);
      const duration = await probeDurationSec(input);
      const plan = planFrameTimes(duration, attachment.markedAtMs);
      let saved = 0;
      for (const p of plan) {
        const out = path.join(dir, `${p.tsMs}.jpg`);
        await extractFrame(input, p.tsMs / 1000, out);
        // 个别时间点（如可变帧率视频的末尾）可能取不到帧，跳过即可
        if (!existsSync(out)) continue;
        saved++;
        const key = `derived/${attachment.defectId}/${attachment.id}/${p.tsMs}.jpg`;
        await this.storage.putObject(key, await readFile(out), 'image/jpeg');
        await this.prisma.videoFrame.upsert({
          where: { attachmentId_tsMs: { attachmentId: attachment.id, tsMs: p.tsMs } },
          create: {
            attachmentId: attachment.id,
            tsMs: p.tsMs,
            storageKey: key,
            nearMark: p.nearMark,
          },
          update: { storageKey: key, nearMark: p.nearMark },
        });
      }
      if (saved === 0) throw new Error(`视频 ${attachment.fileName} 没有抽到任何帧`);
      this.logger.log(`视频 ${attachment.fileName} 抽帧完成：${saved} 帧`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
