/**
 * 模拟 APP 提单，用于联调与验收（接口说明见 docs/app-integration.md）。
 *
 * 场景合起来覆盖接口的每一个字段和每一种取值：
 * - 字段：appId、description、title（传 / 不传）、reportId（含重试）、reporterName（匹配 / 不匹配 / 不传）、
 *   severity（五个取值 + 不传）、frequency（三个取值 + 不传）、steps、appVersion、appBuild、appCommit、
 *   deviceModel、osVersion、page、extra、files（无附件 / 多附件）；
 * - 附件：png、jpg 截图，mp4 录屏（15 秒、60 秒、约 150 MB 的 3 分钟），log、txt 日志，
 *   zip 日志包（内含多个日志），m4a 录音。
 * 传 --token 时，提交后逐个字段核对平台上的缺陷是否和提交的一致，不一致的标 ✘ 并以非 0 退出。
 *
 * 用法（在 apps/server 目录）：
 *   npx tsx scripts/simulate-app-defect.ts [--base http://10.10.0.168:5180] [--app com.example.app]
 *     [--token <个人 API Token 或登录令牌>] [--scenario all|android-crash,unity-freeze,...] [--list]
 * --base   平台地址，默认 http://localhost:{.env 的 PORT}；对着部署好的平台联调时传网页地址
 * --app    已在「项目设置 → APP 接入」绑定的 APP 标识
 * --token  用于读取缺陷做核对（「个人设置」里创建的 Token 即可，只读也行）；不传则只提交不核对
 * 生成的附件缓存在系统临时目录 defect-sim/ 下，再次运行直接复用。
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, openAsBlob, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { crc32, deflateRawSync } from 'node:zlib';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';

if (existsSync('.env')) process.loadEnvFile('.env');

const run = promisify(execFile);
const CACHE = path.join(tmpdir(), 'defect-sim');
mkdirSync(CACHE, { recursive: true });
const MB = 1024 * 1024;

function arg(name: string, fallback = ''): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

// ---------- 附件生成（已存在就复用） ----------

/** 手机截图：带噪点的背景让 PNG / JPG 接近真实截图的大小，上面画一块提示条 */
async function screenshot(
  name: string,
  opts: { width: number; height: number; text: string; color: string },
): Promise<string> {
  const file = path.join(CACHE, name);
  if (existsSync(file)) return file;
  const banner = Buffer.from(
    `<svg width="${opts.width}" height="360"><rect width="${opts.width}" height="360" fill="${opts.color}"/>` +
      `<text x="60" y="210" font-size="64" fill="#ffffff">${opts.text}</text></svg>`,
  );
  const img = sharp({
    create: {
      width: opts.width,
      height: opts.height,
      channels: 3,
      background: '#eef1f5',
      noise: { type: 'gaussian', mean: 200, sigma: 40 },
    },
  }).composite([{ input: banner, top: Math.round(opts.height / 3), left: 0 }]);
  await (name.endsWith('.jpg') ? img.jpeg({ quality: 92 }) : img.png()).toFile(file);
  return file;
}

function ffmpeg(): string {
  if (!ffmpegPath) throw new Error('当前平台没有可用的 ffmpeg，无法生成录屏 / 录音');
  return ffmpegPath as unknown as string;
}

/** 录屏：ffmpeg 生成测试画面，按时长与码率控制文件大小 */
async function video(
  name: string,
  opts: { seconds: number; size: string; bitrate: string },
): Promise<string> {
  const file = path.join(CACHE, name);
  if (existsSync(file)) return file;
  console.log(`  生成录屏 ${name}（${opts.seconds} 秒 ${opts.size}）…`);
  await run(ffmpeg(), [
    ...['-y', '-loglevel', 'error', '-f', 'lavfi'],
    ...['-i', `testsrc2=size=${opts.size}:rate=30:duration=${opts.seconds}`],
    ...['-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', opts.bitrate, '-pix_fmt', 'yuv420p'],
    file,
  ]);
  return file;
}

/** 录音：模拟 APP 一起上传的原始语音（平台原样保存为附件） */
async function audio(name: string, seconds: number): Promise<string> {
  const file = path.join(CACHE, name);
  if (existsSync(file)) return file;
  await run(ffmpeg(), [
    ...['-y', '-loglevel', 'error', '-f', 'lavfi'],
    ...['-i', `sine=frequency=330:duration=${seconds}`, '-c:a', 'aac', '-b:a', '96k'],
    file,
  ]);
  return file;
}

/** 文本日志：正常日志填充到目标大小，在 70% 处插入异常段 */
function textLog(
  name: string,
  targetBytes: number,
  line: (i: number) => string,
  incident: string[],
): string {
  const file = path.join(CACHE, name);
  if (existsSync(file)) return file;
  const out: string[] = [];
  let size = 0;
  let inserted = false;
  for (let i = 0; size < targetBytes; i++) {
    const l = line(i);
    out.push(l);
    size += Buffer.byteLength(l) + 1;
    if (!inserted && size > targetBytes * 0.7) {
      out.push(...incident);
      inserted = true;
    }
  }
  writeFileSync(file, out.join('\n'));
  return file;
}

/** 把几个文件打成 zip（deflate 压缩，文件名 UTF-8），模拟 APP 打包上传的日志 */
function zip(name: string, files: string[]): string {
  const file = path.join(CACHE, name);
  if (existsSync(file)) return file;
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const data = readFileSync(f);
    const packed = deflateRawSync(data);
    const fname = Buffer.from(path.basename(f), 'utf8');
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // 文件名为 UTF-8
    head.writeUInt16LE(8, 8); // deflate
    head.writeUInt16LE(0x21, 12); // 1980-01-01
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(fname.length, 26);
    locals.push(head, fname, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fname.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, fname);
    offset += head.length + fname.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(file, Buffer.concat([...locals, cd, end]));
  return file;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const clock = (i: number) => {
  const ms = 9 * 3600_000 + i * 37;
  return `${pad(Math.floor(ms / 3600_000) % 24)}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
};

function logcat(name: string, targetBytes: number): string {
  const tags = ['ActivityManager', 'OkHttp', 'OrderRepository', 'Glide', 'PayBridge'];
  return textLog(
    name,
    targetBytes,
    (i) =>
      `10-28 ${clock(i)} ${i % 23 === 0 ? 'W' : 'I'}/${tags[i % tags.length]}: request #${i} cost=${(i * 7) % 300}ms orderId=${10000 + (i % 977)}`,
    [
      `10-28 ${clock(99999)} E/AndroidRuntime: FATAL EXCEPTION: main`,
      'Process: com.example.app, PID: 23817',
      'java.lang.IllegalStateException: order status not refreshed after payment callback',
      '    at com.example.order.OrderDetailActivity.refresh(OrderDetailActivity.kt:88)',
      '    at com.example.order.OrderDetailActivity.onResume(OrderDetailActivity.kt:42)',
      '    at android.app.Activity.performResume(Activity.java:8422)',
    ],
  );
}

function unityLog(name: string, targetBytes: number): string {
  return textLog(
    name,
    targetBytes,
    (i) =>
      `${clock(i)}|${i % 31 === 0 ? 'W' : 'L'}|[Battle] frame=${i} hp=${(i * 13) % 1000} skill=${i % 9} cost=${(i * 3) % 40}ms`,
    [
      `${clock(88888)}|E|NullReferenceException: Object reference not set to an instance of an object`,
      '  at BattleController.UpdateSkillCooldown (System.Single deltaTime) [0x0001a] in <8f3c2d1e>:0',
      '  at BattleController.Update () [0x00012] in <8f3c2d1e>:0',
      `${clock(88889)}|E|[Battle] 技能冷却表为空，战斗主循环停止`,
    ],
  );
}

function networkLog(name: string, targetBytes: number): string {
  return textLog(
    name,
    targetBytes,
    (i) =>
      `2026-10-28 ${clock(i)} [I] HTTP GET /api/v2/feed?page=${i % 50} -> 200 (${(i * 11) % 400}ms)`,
    [
      `2026-10-28 ${clock(77777)} [E] HTTP POST /api/v2/auth/login -> 502 Bad Gateway (30012ms)`,
      `2026-10-28 ${clock(77778)} [E] LoginViewModel: 登录失败，token 为空，重试 1/3`,
      `2026-10-28 ${clock(77779)} [E] HTTP POST /api/v2/auth/login -> 502 Bad Gateway (30008ms)`,
    ],
  );
}

// ---------- 场景 ----------

interface Scenario {
  key: string;
  label: string;
  /** 同一个 reportId 提交两次，验证重试不重复建单 */
  retry?: boolean;
  /** 日志摘要里应出现的内容（附件里有日志时） */
  logHint?: string;
  build: () => Promise<{ fields: Record<string, string>; files: string[] }>;
}

const SCENARIOS: Scenario[] = [
  {
    key: 'android-crash',
    label: '安卓支付后闪退：不传标题、严重、必现，3 张大 PNG + 3 MB logcat + 15 秒录屏',
    logHint: 'IllegalStateException',
    build: async () => ({
      fields: {
        description: '用微信支付成功后返回 APP，订单页仍显示待支付，几秒后闪退。每次都能复现。',
        reporterName: '测试小王',
        severity: 'serious',
        frequency: 'always',
        steps: '1. 购物车结算\n2. 选择微信支付并完成付款\n3. 返回 APP 查看订单详情',
        appVersion: '3.12.0',
        appBuild: '31200',
        appCommit: 'a1b2c3d4e5f6',
        deviceModel: 'Pixel 9',
        osVersion: 'Android 15',
        page: 'OrderDetailActivity',
        extra: JSON.stringify({ network: 'WIFI', channel: 'googleplay', userId: 'u_10086' }),
      },
      files: [
        await screenshot('android-1.png', {
          width: 1080,
          height: 2400,
          text: '订单状态：待支付',
          color: '#cf1322',
        }),
        await screenshot('android-2.png', {
          width: 1080,
          height: 2400,
          text: '支付成功',
          color: '#389e0d',
        }),
        await screenshot('android-3.png', {
          width: 1080,
          height: 2400,
          text: '应用已停止运行',
          color: '#595959',
        }),
        logcat('logcat-crash.log', 3 * MB),
        await video('android-record.mp4', { seconds: 15, size: '720x1280', bitrate: '3M' }),
      ],
    }),
  },
  {
    key: 'ios-layout',
    label: 'iOS 布局错位：带标题、一般、必现，2 张大 JPG（竖屏 + 横屏）',
    build: async () => ({
      fields: {
        title: '订单列表在 iPhone 15 上价格与按钮重叠',
        description: '横竖屏切换后，订单列表右侧价格压在「再次购买」按钮上，看不清金额。',
        reporterName: '测试小王',
        severity: 'normal',
        frequency: 'always',
        steps: '1. 打开「我的订单」\n2. 横屏后再竖屏',
        appVersion: '3.12.0',
        appBuild: '31201',
        appCommit: 'f6e5d4c3b2a1',
        deviceModel: 'iPhone 15',
        osVersion: 'iOS 18.1',
        page: 'OrderListViewController',
      },
      files: [
        await screenshot('ios-1.jpg', {
          width: 1179,
          height: 2556,
          text: '¥128.00 再次购买',
          color: '#1677ff',
        }),
        await screenshot('ios-2.jpg', {
          width: 2556,
          height: 1179,
          text: '横屏：按钮被遮挡',
          color: '#1677ff',
        }),
      ],
    }),
  },
  {
    key: 'unity-freeze',
    label:
      'Unity 战斗卡死：致命、随机，提单人匹配不上，zip 日志包（8 MB + 2 MB）+ 60 秒 1080p 录屏',
    logHint: 'NullReferenceException',
    build: async () => ({
      fields: {
        description: '第三关 Boss 战释放大招后画面卡住不动，音乐还在放，只能杀进程。出现过三次。',
        reporterName: '张三',
        severity: 'fatal',
        frequency: 'random',
        appVersion: '1.0.22',
        appBuild: '1022',
        appCommit: '9c8b7a6',
        deviceModel: 'Xiaomi 14',
        osVersion: 'Android 14',
        page: 'BattleScene',
        extra: JSON.stringify({ engine: 'Unity 2022.3.21f1', quality: 'High', fps: 60 }),
      },
      files: [
        zip('unity-logs.zip', [
          unityLog('Player.log', 8 * MB),
          unityLog('Player-prev.log', 2 * MB),
        ]),
        await video('unity-battle.mp4', { seconds: 60, size: '1920x1080', bitrate: '4M' }),
        await screenshot('unity-1.png', {
          width: 2400,
          height: 1080,
          text: 'Boss 战画面卡住',
          color: '#722ed1',
        }),
      ],
    }),
  },
  {
    key: 'voice-report',
    label:
      '语音描述：只传转写文字，不传标题 / 严重程度 / 重现规律（看默认值），附原始录音 m4a + 截图',
    build: async () => ({
      fields: {
        description:
          '嗯就是我在购物车里面改了商品数量以后 总价没有变 还是原来的价格 然后去结算的时候价格又是对的 感觉是购物车页面没刷新',
        reporterName: '测试小王',
        appVersion: '3.12.0',
        deviceModel: 'HUAWEI Mate 60',
        osVersion: 'HarmonyOS 4.2',
        page: 'CartActivity',
      },
      files: [
        await audio('voice-note.m4a', 15),
        await screenshot('cart.png', {
          width: 1080,
          height: 2400,
          text: '合计：¥99.00',
          color: '#fa8c16',
        }),
      ],
    }),
  },
  {
    key: 'login-random',
    label: '登录偶现失败：严重、随机，提单人匹配不上，1 MB 网络日志 txt + 截图',
    logHint: '502',
    build: async () => ({
      fields: {
        title: '弱网下登录偶现一直转圈',
        description: '地铁里用 4G 登录，大概五次有一次一直转圈，30 秒后提示网络错误。',
        reporterName: '外包测试-李四',
        severity: 'serious',
        frequency: 'random',
        steps: '1. 切到 4G 弱网\n2. 输入账号密码登录',
        appVersion: '3.11.5',
        appBuild: '31150',
        deviceModel: 'OPPO Find X7',
        osVersion: 'Android 14',
        page: 'LoginActivity',
      },
      files: [
        networkLog('network.txt', 1 * MB),
        await screenshot('login.png', {
          width: 1080,
          height: 2400,
          text: '网络错误，请重试',
          color: '#d4380d',
        }),
      ],
    }),
  },
  {
    key: 'copy-tip',
    label: '文案问题：提示、不可重现，不传提单人、不带任何附件',
    build: async () => ({
      fields: {
        title: '优惠券过期提示文案有错别字',
        description:
          '优惠券列表里过期的券提示「已过其」，应为「已过期」。只见过一次，之后没再出现。',
        severity: 'prompt',
        frequency: 'never',
        appVersion: '3.12.0',
        deviceModel: 'Pixel 7',
        osVersion: 'Android 14',
        page: 'CouponListFragment',
      },
      files: [],
    }),
  },
  {
    key: 'suggestion',
    label: '体验建议：建议级别，带复现步骤，1 张 JPG',
    build: async () => ({
      fields: {
        title: '建议：订单详情页增加「复制订单号」按钮',
        description: '联系客服时需要报订单号，现在只能手抄，建议加一个复制按钮。',
        reporterName: '测试小王',
        severity: 'advice',
        steps: '1. 打开任意订单详情\n2. 找订单号',
        appVersion: '3.12.0',
        deviceModel: 'iPhone 13',
        osVersion: 'iOS 17.6',
        page: 'OrderDetailViewController',
      },
      files: [
        await screenshot('order-no.jpg', {
          width: 1170,
          height: 2532,
          text: '订单号：202610281234567',
          color: '#13c2c2',
        }),
      ],
    }),
  },
  {
    key: 'big-video',
    label: '长录屏大文件：约 150 MB 的 3 分钟 1080p 录屏 + 5 MB Unity 日志',
    logHint: 'NullReferenceException',
    build: async () => ({
      fields: {
        description: '连续玩 3 分钟后帧率明显下降，录屏后半段能看到卡顿。',
        reporterName: '测试小王',
        severity: 'normal',
        frequency: 'always',
        appVersion: '1.0.22',
        appBuild: '1022',
        deviceModel: 'Redmi K70',
        osVersion: 'Android 14',
        page: 'MainCity',
      },
      files: [
        await video('long-record.mp4', { seconds: 180, size: '1920x1080', bitrate: '6.5M' }),
        unityLog('unity-long.log', 5 * MB),
      ],
    }),
  },
  {
    key: 'retry',
    label: '超时重试：同一个 reportId 提交两次，第二次返回原编号、不重复建单',
    retry: true,
    build: async () => ({
      fields: {
        description: '我的页面头像偶尔显示成默认头像。',
        reporterName: '测试小王',
        deviceModel: 'Pixel 8',
        osVersion: 'Android 14',
      },
      files: [
        await screenshot('avatar.png', {
          width: 1080,
          height: 2400,
          text: '默认头像',
          color: '#8c8c8c',
        }),
      ],
    }),
  },
];

// ---------- 提交与核对 ----------

type Json = Record<string, unknown>;

async function submit(
  base: string,
  appId: string,
  reportId: string,
  fields: Record<string, string>,
  files: string[],
): Promise<{ status: number; body: Json | string; seconds: number }> {
  const form = new FormData();
  form.set('appId', appId);
  form.set('reportId', reportId);
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  // openAsBlob 按需读文件，大录屏不会整个读进内存
  for (const f of files) form.append('files', await openAsBlob(f), path.basename(f));
  const started = Date.now();
  const res = await fetch(`${base}/api/v1/app/defects`, { method: 'POST', body: form });
  const text = await res.text();
  let body: Json | string = text;
  try {
    body = JSON.parse(text) as Json;
  } catch {
    // 非 JSON（如 nginx 的 413 页面）原样输出
  }
  return { status: res.status, body, seconds: (Date.now() - started) / 1000 };
}

/** 与服务端一致：没传标题时取描述的第一句话，最多 60 个字 */
function expectedTitle(fields: Record<string, string>): string {
  if (fields.title) return fields.title;
  const first =
    fields
      .description!.split(/[\n。！？!?；;]/)
      .map((s) => s.trim())
      .find(Boolean) ?? '';
  return first.length > 60 ? `${first.slice(0, 60)}…` : first;
}

function kindOf(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'webm', 'm4v'].includes(ext)) return 'video';
  if (['log', 'txt', 'zip', 'xlog', 'gz'].includes(ext)) return 'log';
  return 'other';
}

/** 键排好序的 JSON，用于不看键顺序的比较 */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Json)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/** 读回缺陷，逐个字段核对提交的内容是否生效 */
async function verify(
  base: string,
  token: string,
  appId: string,
  url: string,
  s: Scenario,
  fields: Record<string, string>,
  files: string[],
): Promise<number> {
  const [, , key, , code] = url.split('/');
  const res = await fetch(`${base}/api/v1/projects/${key}/defects/${code}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.log(`    ✘ 读取缺陷失败 HTTP ${res.status}，检查 --token`);
    return 1;
  }
  const d = (await res.json()) as Json;
  const desc = String(d.description ?? '');
  const info = (d.deviceInfo ?? {}) as Json;
  const app = (info.app ?? {}) as Json;
  const dev = (info.device ?? {}) as Json;
  const checks: [string, boolean, string][] = [];
  const eq = (label: string, actual: unknown, expected: unknown) => {
    // 按内容比较：数据库 JSON 字段会重排对象的键顺序
    const same = canonical(actual) === canonical(expected);
    checks.push([
      label,
      same,
      `${JSON.stringify(actual)}${same ? '' : `，应为 ${JSON.stringify(expected)}`}`,
    ]);
  };
  const has = (label: string, ok: boolean, detail: string) => checks.push([label, ok, detail]);

  eq('source 来源', d.source, 'app');
  eq('title 标题', d.title, expectedTitle(fields));
  has('description 描述', desc.startsWith(fields.description!), '描述正文');
  eq('severity 严重程度', d.severity, fields.severity ?? 'normal');
  eq('frequency 重现规律', d.frequency ?? null, fields.frequency ?? null);
  eq('steps 复现步骤', d.steps, fields.steps ?? '');
  eq('appCommit', d.appCommit ?? null, fields.appCommit ?? null);
  eq('appId', app.id, appId);
  eq('appVersion', app.version ?? null, fields.appVersion ?? null);
  eq('appBuild', app.build ?? null, fields.appBuild ?? null);
  eq('deviceModel', dev.model ?? null, fields.deviceModel ?? null);
  eq('osVersion', dev.os ?? null, fields.osVersion ?? null);
  eq('page', info.page ?? null, fields.page ?? null);
  eq('extra', info.extra ?? null, fields.extra ? JSON.parse(fields.extra) : null);
  has('描述里的 APP 信息', desc.includes(`APP：${appId}`), `含「APP：${appId}」`);
  if (fields.reporterName) {
    const linked = d.reporterId != null;
    const noted = desc.includes(`提单人：${fields.reporterName}`);
    has(
      'reporterName 提单人',
      linked !== noted,
      linked ? '已关联平台用户（创建人）' : '未匹配到平台用户，姓名写在描述里',
    );
  } else {
    has('reporterName 不传', d.reporterId == null && !desc.includes('提单人：'), '无提单人');
  }
  const atts = ((d.attachments ?? []) as Json[]).map((a) => ({
    name: String(a.fileName),
    kind: String(a.kind),
    size: Number(a.size),
  }));
  const expectAtts = files.map((f) => ({
    name: path.basename(f),
    kind: kindOf(f),
    size: statSync(f).size,
  }));
  const sortByName = (list: { name: string }[]) =>
    [...list].sort((a, b) => a.name.localeCompare(b.name));
  eq('files 附件（名称、类型、大小）', sortByName(atts), sortByName(expectAtts));
  if (s.logHint) {
    const summary = String(d.logSummary ?? '');
    has('日志摘要', summary.includes(s.logHint), `含「${s.logHint}」`);
  }

  let failed = 0;
  for (const [label, ok, detail] of checks) {
    if (!ok) failed++;
    console.log(`    ${ok ? '✔' : '✘'} ${label}：${detail}`);
  }
  return failed;
}

async function main(): Promise<void> {
  if (process.argv.includes('--list')) {
    for (const s of SCENARIOS) console.log(`${s.key.padEnd(14)} ${s.label}`);
    return;
  }
  const base = arg('base', `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/$/, '');
  const appId = arg('app', 'com.example.app');
  const token = arg('token');
  const wanted = arg('scenario', 'all');
  const list =
    wanted === 'all' ? SCENARIOS : SCENARIOS.filter((s) => wanted.split(',').includes(s.key));
  if (list.length === 0) throw new Error(`没有场景 ${wanted}，用 --list 查看`);

  console.log(`平台 ${base}，APP 标识 ${appId}，共 ${list.length} 个场景`);
  if (!token) console.log('未传 --token：只提交，不核对字段');
  console.log('');
  let failed = 0;
  for (const s of list) {
    console.log(`▶ ${s.key}：${s.label}`);
    const { fields, files } = await s.build();
    const total = files.reduce((n, f) => n + statSync(f).size, 0);
    console.log(
      `  附件 ${files.length} 个，共 ${(total / MB).toFixed(1)} MB${files.length ? '：' : ''}${files
        .map((f) => `${path.basename(f)}(${(statSync(f).size / MB).toFixed(1)}MB)`)
        .join('、')}`,
    );
    const reportId = randomUUID();
    let firstCode = '';
    for (let round = 0; round < (s.retry ? 2 : 1); round++) {
      const res = await submit(base, appId, reportId, fields, files);
      const body = res.body;
      if (res.status !== 201 || typeof body !== 'object') {
        failed++;
        const msg = typeof body === 'object' ? String(body.message) : body.slice(0, 200);
        console.log(`  ✘ HTTP ${res.status}：${msg}`);
        break;
      }
      const code = String(body.code);
      console.log(
        `  ${round === 0 ? '✔' : '↻'} ${code}（${body.created ? '新建' : '重试，未重复建单'}）耗时 ${res.seconds.toFixed(1)} 秒  ${base}${String(body.url)}`,
      );
      if (round === 0) {
        firstCode = code;
        if (token) failed += await verify(base, token, appId, String(body.url), s, fields, files);
      } else if (body.created !== false || code !== firstCode) {
        failed++;
        console.log(`  ✘ 重试应返回原编号 ${firstCode} 且 created=false`);
      }
    }
    console.log('');
  }
  if (failed) {
    console.log(`共 ${failed} 项失败`);
    process.exit(1);
  }
  console.log('全部通过');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
