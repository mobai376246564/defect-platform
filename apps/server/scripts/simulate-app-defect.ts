/**
 * 模拟 APP 提单，用于联调（接口说明见 docs/app-integration.md）：
 * 生成一张截图和一份崩溃日志，按 APP 的方式调用 POST /api/v1/app/defects。
 *
 * 用法（在 apps/server 目录）：
 *   npx tsx scripts/simulate-app-defect.ts [--app com.example.app] [--reporter 测试小王]
 *     [--base http://localhost:3000] [--desc "..."]
 * --base 默认取 apps/server/.env 的 PORT，对着部署好的平台联调时传网页地址，如 http://10.10.0.168:5180。
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import sharp from 'sharp';

if (existsSync('.env')) process.loadEnvFile('.env');

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

async function main(): Promise<void> {
  const base = arg('base', `http://localhost:${process.env.PORT ?? 3000}`);
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
    .png()
    .toBuffer();

  const form = new FormData();
  form.set('appId', arg('app', 'com.example.app'));
  form.set(
    'description',
    arg('desc', '用微信支付成功后返回 APP，订单页仍显示待支付，随后闪退。必现。'),
  );
  form.set('reportId', randomUUID());
  form.set('reporterName', arg('reporter', '测试小王'));
  form.set('severity', 'serious');
  form.set('frequency', 'always');
  form.set('appVersion', '3.12.0');
  form.set('appBuild', '31200');
  form.set('deviceModel', 'Pixel 9');
  form.set('osVersion', 'Android 15');
  form.set('page', 'OrderDetailActivity');
  form.set('extra', JSON.stringify({ network: 'WIFI', channel: 'simulator' }));
  form.append('files', new Blob([screenshot], { type: 'image/png' }), '截图1.png');
  form.append('files', new Blob([log], { type: 'text/plain' }), 'app.log');

  const res = await fetch(`${base}/api/v1/app/defects`, { method: 'POST', body: form });
  console.log(`HTTP ${res.status} ${await res.text()}`);
  if (!res.ok) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
