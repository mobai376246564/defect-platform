/**
 * 模拟 APP 提交一条反馈，用于联调（方案 5.6）：
 *   1. 按约定目录写入日志、截图与 manifest.json（本地存储或 COS）
 *   2. 以 SCF 的格式、带 HMAC 签名调用平台的 COS 事件接口
 *
 * 用法（在 apps/server 目录）：
 *   npx tsx scripts/simulate-feedback.ts [--app com.example.app] [--title "..."] [--no-event]
 * --no-event 只写文件不发事件，用于验证定时对账能否补单。
 * 读取 apps/server/.env 中的 STORAGE_DRIVER、COS_*、INGEST_HMAC_SECRET、PORT。
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { feedbackPrefix } from '@defect/shared';
import sharp from 'sharp';
import { hmacSha256Hex } from '../src/common/crypto';
import { loadEnv } from '../src/config/env';
import { CosStorage } from '../src/storage/cos.storage';
import { LocalStorage } from '../src/storage/local.storage';
import type { ObjectStorage } from '../src/storage/storage.types';

if (existsSync('.env')) process.loadEnvFile('.env');

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const appId = arg('app', 'com.example.app');
  const title = arg('title', '支付成功后订单页闪退（模拟反馈）');
  const storage: ObjectStorage =
    env.STORAGE_DRIVER === 'cos'
      ? new CosStorage({
          secretId: env.COS_SECRET_ID!,
          secretKey: env.COS_SECRET_KEY!,
          bucket: env.COS_BUCKET!,
          region: env.COS_REGION,
          appId: env.COS_APPID!,
        })
      : new LocalStorage(
          path.resolve(env.LOCAL_STORAGE_DIR),
          env.LOCAL_STORAGE_SECRET,
          env.PUBLIC_BASE_URL,
        );

  const reportId = randomUUID();
  const prefix = feedbackPrefix(appId, new Date(), reportId);
  const log = [
    `${new Date().toISOString()} I/OrderPage: onResume orderId=10086`,
    `${new Date().toISOString()} E/AndroidRuntime: FATAL EXCEPTION: main`,
    'java.lang.IllegalStateException: order status not refreshed after payment callback',
    '    at com.example.order.OrderDetailActivity.refresh(OrderDetailActivity.kt:88)',
    '    at com.example.order.OrderDetailActivity.onResume(OrderDetailActivity.kt:42)',
    '    at android.app.Activity.performResume(Activity.java:8422)',
  ].join('\n');
  const screenshot = await sharp({
    create: { width: 1080, height: 2400, channels: 3, background: '#f5f5f5' },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="1080" height="400"><rect width="1080" height="400" fill="#fff1f0"/>' +
            '<text x="80" y="220" font-size="72" fill="#cf1322">订单状态：待支付</text></svg>',
        ),
        top: 600,
        left: 0,
      },
    ])
    .webp()
    .toBuffer();

  await storage.putObject(`${prefix}app.log`, Buffer.from(log), 'text/plain');
  await storage.putObject(`${prefix}screenshot_1.webp`, screenshot, 'image/webp');
  const manifest = {
    schemaVersion: 1,
    reportId,
    appId,
    title,
    description: '用微信支付成功后返回 APP，订单页仍显示待支付，随后闪退。',
    category: 'CRASH',
    reproducible: 'ALWAYS',
    app: { version: '3.12.0', build: '31200', commit: 'a1b2c3d', channel: 'simulator' },
    device: { os: 'Android 15', model: 'Pixel 9', network: 'WIFI' },
    context: {
      page: 'OrderDetailActivity',
      trail: ['Home', 'Cart', 'Pay', 'OrderDetail'],
      crashId: null,
    },
    user: { uidHash: 'sha256:simulated' },
    attachments: [
      { key: 'app.log', type: 'log', size: Buffer.byteLength(log) },
      { key: 'screenshot_1.webp', type: 'image', size: screenshot.length },
    ],
    createdAt: new Date().toISOString(),
  };
  await storage.putObject(
    `${prefix}manifest.json`,
    Buffer.from(JSON.stringify(manifest)),
    'application/json',
  );
  console.log(`已写入反馈：${prefix}`);

  if (process.argv.includes('--no-event')) {
    console.log('未发送事件，等待定时对账补单');
    return;
  }
  const body = JSON.stringify({
    bucket: env.COS_BUCKET ?? 'local',
    region: env.COS_REGION,
    key: `${prefix}manifest.json`,
    eventTime: new Date().toISOString(),
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const res = await fetch(`http://localhost:${env.PORT}/api/v1/ingest/cos-event`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Timestamp': ts,
      'X-Signature': hmacSha256Hex(env.INGEST_HMAC_SECRET, `${ts}.${body}`),
    },
    body,
  });
  console.log(`事件已发送：HTTP ${res.status} ${await res.text()}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
