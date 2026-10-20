import { z } from 'zod';

const boolString = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    PUBLIC_BASE_URL: z.url().default('http://localhost:3000'),
    WEB_ORIGIN: z.string().default('http://localhost:5173'),

    DATABASE_URL: z.string().min(1),
    /** 数据库连接池大小与单条 SQL 的超时（毫秒），防止慢查询长时间占住连接 */
    DB_POOL_MAX: z.coerce.number().int().min(1).default(10),
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(30_000),
    /** 每个 IP 每分钟的请求上限（全局兜底）与登录 / 注册的上限；测试环境不限流 */
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(600),
    AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),

    JWT_SECRET: z.string().min(16, 'JWT_SECRET 至少 16 位'),
    JWT_EXPIRES_IN: z.string().default('12h'),

    STORAGE_DRIVER: z.enum(['local', 'cos']).default('local'),
    LOCAL_STORAGE_DIR: z.string().default('../../.data/storage'),
    LOCAL_STORAGE_SECRET: z.string().default('dev-local-storage-secret'),
    COS_SECRET_ID: z.string().optional(),
    COS_SECRET_KEY: z.string().optional(),
    COS_BUCKET: z.string().optional(),
    COS_REGION: z.string().default('ap-guangzhou'),
    COS_APPID: z.string().optional(),

    INGEST_HMAC_SECRET: z.string().min(8, 'INGEST_HMAC_SECRET 至少 8 位'),
    RECONCILE_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(10),
    RUN_WORKER: boolString.default(true),

    /** 在线更新（仅 macOS / Linux 上的 pm2 单机部署）：管理后台检查新版本并一键更新 */
    SELF_UPDATE: boolString,
    UPDATE_REMOTE: z
      .string()
      .regex(/^[\w.-]+$/)
      .default('origin'),
    UPDATE_BRANCH: z
      .string()
      .regex(/^[\w./-]+$/)
      .default('main'),
    /** 定时检查新版本的间隔（分钟），0 表示只在打开“系统更新”页或手动检查时检查 */
    UPDATE_CHECK_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(60),
    /** 代码仓库目录，默认取服务端所在的 git 仓库根目录（测试时指向临时仓库） */
    UPDATE_REPO_DIR: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === 'cos') {
      for (const k of ['COS_SECRET_ID', 'COS_SECRET_KEY', 'COS_BUCKET', 'COS_APPID'] as const) {
        if (!env[k])
          ctx.addIssue({ code: 'custom', path: [k], message: `STORAGE_DRIVER=cos 时 ${k} 必填` });
      }
    }
    if (env.NODE_ENV === 'production') {
      if (env.JWT_SECRET.startsWith('change-me')) {
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_SECRET'],
          message: '生产环境必须替换 JWT_SECRET',
        });
      }
      if (env.INGEST_HMAC_SECRET.startsWith('change-me')) {
        ctx.addIssue({
          code: 'custom',
          path: ['INGEST_HMAC_SECRET'],
          message: '生产环境必须替换 INGEST_HMAC_SECRET',
        });
      }
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`环境变量配置有误：\n${detail}`);
  }
  return parsed.data;
}

/** Nest 注入令牌 */
export const APP_ENV = Symbol('APP_ENV');
