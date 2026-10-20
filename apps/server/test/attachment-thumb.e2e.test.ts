import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTestApp, createUser, projectKey, type TestContext } from './helpers';

describe('image attachment thumbnails (e2e)', () => {
  let ctx: TestContext;
  let token: string;
  let key: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    token = (await createUser(ctx, { isSystemAdmin: true })).token;
    key = projectKey('THB');
    await ctx.http.post('/api/v1/projects').set(auth(token)).send({ key, name: key }).expect(201);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('returns a small webp thumbnail for images, generated once and reused', async () => {
    const code = (
      await ctx.http
        .post(`/api/v1/projects/${key}/defects`)
        .set(auth(token))
        .send({ title: '截图', severity: 'normal' })
        .expect(201)
    ).body.code as string;
    const png = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: '#3366ff' },
    })
      .png()
      .toBuffer();
    const target = await ctx.http
      .post(`/api/v1/projects/${key}/defects/${code}/attachments/upload-target`)
      .set(auth(token))
      .send({ files: [{ name: 'shot.png', size: png.length }] })
      .expect(201);
    const upload = target.body.uploads[0] as { key: string; url: string };
    const put = new URL(upload.url);
    await ctx.http
      .put(put.pathname + put.search)
      .set('Content-Type', 'application/octet-stream')
      .send(png)
      .expect(200);
    const [att] = (
      await ctx.http
        .post(`/api/v1/projects/${key}/defects/${code}/attachments`)
        .set(auth(token))
        .send({ items: [{ key: upload.key, name: 'shot.png' }] })
        .expect(201)
    ).body as { id: string }[];

    const link = await ctx.http
      .get(`/api/v1/projects/${key}/attachments/${att!.id}/url`)
      .set(auth(token))
      .expect(200);
    expect(link.body.thumbUrl).toBeTruthy();
    const thumbUrl = new URL(link.body.thumbUrl as string);
    const thumb = await ctx.http
      .get(thumbUrl.pathname + thumbUrl.search)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const meta = await sharp(thumb.body as Buffer).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 160, height: 160 });
    expect((thumb.body as Buffer).length).toBeLessThan(png.length);

    // 再次请求复用已生成的缩略图
    const again = await ctx.http
      .get(`/api/v1/projects/${key}/attachments/${att!.id}/url`)
      .set(auth(token))
      .expect(200);
    expect(new URL(again.body.thumbUrl as string).pathname).toBe(thumbUrl.pathname);
  });
});
