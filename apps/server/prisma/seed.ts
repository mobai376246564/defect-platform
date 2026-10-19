/**
 * 初始化数据：系统管理员 + 示例项目。可重复执行（已存在则跳过）。
 *
 * 生产环境首次部署时，通过环境变量指定管理员账号：
 *   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD / SEED_ADMIN_NAME
 * 本地开发不设置时使用下方的开发默认账号（仅限本地使用）。
 * SEED_DEMO=false 可跳过示例项目与示例成员。
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { DEFAULT_WORKFLOW } from '@defect/shared';
import bcrypt from 'bcryptjs';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client';

const DEV_USERS = [
  { email: 'admin@example.com', name: '管理员', password: 'Admin@123456', isSystemAdmin: true },
  {
    email: 'tester@example.com',
    name: '测试小王',
    password: 'Tester@123456',
    isSystemAdmin: false,
  },
  { email: 'dev@example.com', name: '开发小李', password: 'Dev@1234567', isSystemAdmin: false },
];

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  try {
    const isProd = process.env.NODE_ENV === 'production';
    const adminEmail = process.env.SEED_ADMIN_EMAIL?.toLowerCase();
    if (isProd && (!adminEmail || !process.env.SEED_ADMIN_PASSWORD)) {
      throw new Error('生产环境请设置 SEED_ADMIN_EMAIL 与 SEED_ADMIN_PASSWORD');
    }

    const users = adminEmail
      ? [
          {
            email: adminEmail,
            name: process.env.SEED_ADMIN_NAME ?? '管理员',
            password: process.env.SEED_ADMIN_PASSWORD!,
            isSystemAdmin: true,
          },
        ]
      : DEV_USERS;

    const ids: Record<string, string> = {};
    for (const u of users) {
      const existing = await prisma.user.findUnique({ where: { email: u.email } });
      const user =
        existing ??
        (await prisma.user.create({
          data: {
            email: u.email,
            name: u.name,
            isSystemAdmin: u.isSystemAdmin,
            passwordHash: await bcrypt.hash(u.password, 10),
          },
        }));
      ids[u.email] = user.id;
      console.log(`${existing ? '已存在' : '已创建'}用户：${u.email}`);
    }

    if (process.env.SEED_DEMO === 'false' || adminEmail) return;

    const project =
      (await prisma.project.findUnique({ where: { key: 'APP' } })) ??
      (await prisma.project.create({
        data: {
          key: 'APP',
          name: '示例 APP',
          description:
            '演示项目：绑定包名 com.example.app，可用 scripts/simulate-feedback.ts 模拟 APP 反馈',
          appIds: ['com.example.app'],
          workflow: DEFAULT_WORKFLOW as unknown as Prisma.InputJsonValue,
          defaultOwnerId: ids['dev@example.com'],
        },
      }));

    const roles: [string, 'admin' | 'tester' | 'developer'][] = [
      ['admin@example.com', 'admin'],
      ['tester@example.com', 'tester'],
      ['dev@example.com', 'developer'],
    ];
    for (const [email, role] of roles) {
      await prisma.projectMember.upsert({
        where: { projectId_userId: { projectId: project.id, userId: ids[email]! } },
        create: { projectId: project.id, userId: ids[email]!, role },
        update: {},
      });
    }

    for (const name of ['订单', '支付', '登录注册', '首页']) {
      const exists = await prisma.module.findFirst({
        where: { projectId: project.id, name, parentId: null },
      });
      if (!exists) {
        await prisma.module.create({
          data: { projectId: project.id, name, ownerId: ids['dev@example.com'] },
        });
      }
    }
    await prisma.version.upsert({
      where: { projectId_name: { projectId: project.id, name: '3.12.0' } },
      create: { projectId: project.id, name: '3.12.0', build: '31200', commit: 'a1b2c3d' },
      update: {},
    });
    console.log('示例项目 APP 已就绪');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
