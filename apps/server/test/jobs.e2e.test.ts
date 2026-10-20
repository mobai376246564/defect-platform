import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JobsService } from '../src/jobs/jobs.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, type TestContext } from './helpers';

describe('job queue lanes (e2e)', () => {
  let ctx: TestContext;
  let jobs: JobsService;
  let prisma: PrismaService;
  const ran: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    jobs = ctx.app.get(JobsService);
    prisma = ctx.app.get(PrismaService);
    jobs.register('video.lane-test', async (p) => void ran.push(`video:${String(p.n)}`));
    jobs.register('lane.default-test', async (p) => void ran.push(`default:${String(p.n)}`));
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('runs media jobs and other jobs on separate lanes', async () => {
    const video = await jobs.enqueue('video.lane-test', { n: 1 });
    const other = await jobs.enqueue('lane.default-test', { n: 2 });

    // 抽帧通道只取 video.* 任务，默认通道只取其他任务，互不阻塞
    expect(await jobs.runOnce('default')).toBe(true);
    expect(ran).toEqual(['default:2']);
    expect(await jobs.runOnce('media')).toBe(true);
    expect(ran).toEqual(['default:2', 'video:1']);

    for (const j of [video, other]) {
      expect((await prisma.job.findUniqueOrThrow({ where: { id: j.id } })).status).toBe('done');
    }
  });
});
