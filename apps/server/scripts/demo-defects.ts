/**
 * 生成演示缺陷：不同状态、严重程度、优先级、处理人、模块，用于体验列表、筛选、批量修改与看板。
 *
 * 用法（在 apps/server 目录）：
 *   npx tsx scripts/demo-defects.ts [--project APP] [--count 20]
 * 读取 apps/server/.env 的 DATABASE_URL。缺陷编号接着项目现有编号递增，描述里注明“演示数据”，可随时删除。
 * 直接写库（与种子脚本一致），按服务端规则维护编号、状态类别、等级列、时间点与变更历史，不发通知。
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PRIORITY_RANK,
  SEVERITY_RANK,
  findState,
  type Priority,
  type Severity,
  type WorkflowDefinition,
} from '@defect/shared';
import { PrismaClient } from '../src/generated/prisma/client';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const TITLES = [
  '支付成功后订单页仍显示待支付',
  '购物车数量角标不刷新',
  '登录页验证码倒计时结束后按钮不可点',
  '首页 Banner 在 iPad 上被拉伸',
  '订单列表下拉刷新偶现白屏',
  '优惠券叠加后实付金额计算错误',
  '退款申请提交后无任何提示',
  '消息推送点击后未跳转到对应订单',
  '地址编辑页省市区选择器卡顿',
  '商品详情页视频无法全屏播放',
  '夜间模式下评论区文字看不清',
  '弱网下提交订单重复扣款',
  '搜索结果分页加载重复数据',
  '个人中心头像上传后显示旧头像',
  '安卓 15 上相机权限弹窗反复出现',
  '物流轨迹时间显示为 UTC',
  '会员到期提醒每天重复发送 3 次',
  '客服会话图片发送失败无重试',
  '发票抬头保存后再次进入为空',
  '应用切到后台再回来登录态丢失',
];
const SEVERITIES: Severity[] = ['fatal', 'serious', 'normal', 'prompt', 'advice'];
const PRIORITIES: (Priority | null)[] = ['urgent', 'high', 'medium', 'low', 'insignificant', null];
const FREQUENCIES = ['always', 'often', 'sometimes', 'rarely'];

async function main(): Promise<void> {
  const projectKey = arg('project', 'APP').toUpperCase();
  const count = Math.min(Math.max(Number(arg('count', '20')) || 20, 1), 200);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  try {
    const project = await prisma.project.findUnique({
      where: { key: projectKey },
      include: { members: { include: { user: true } }, modules: true },
    });
    if (!project) throw new Error(`项目 ${projectKey} 不存在`);
    const workflow = project.workflow as unknown as WorkflowDefinition;
    const members = project.members.filter((m) => m.role !== 'viewer');
    if (members.length === 0) throw new Error('项目里没有可指派的成员');
    const reporter =
      members.find((m) => m.role === 'tester') ??
      members.find((m) => m.role === 'admin') ??
      members[0]!;
    const states = workflow.states;
    const now = Date.now();

    for (let i = 0; i < count; i++) {
      const state = states[i % states.length]!;
      const severity = SEVERITIES[i % SEVERITIES.length]!;
      const priority = PRIORITIES[(i * 5) % PRIORITIES.length] ?? null;
      // 每 7 个留一个未指派，其余在成员间轮换
      const owner = i % 7 === 6 ? null : members[i % members.length]!;
      const module =
        project.modules.length && i % 4 !== 3 ? project.modules[i % project.modules.length]! : null;
      const createdAt = new Date(now - (count - i) * 5 * 3600_000);
      const later = (h: number) => new Date(createdAt.getTime() + h * 3600_000);
      const category = state.category;
      const initial = findState(workflow, workflow.initialState) ?? states[0]!;

      await prisma.$transaction(async (tx) => {
        const { defectSeq } = await tx.project.update({
          where: { id: project.id },
          data: { defectSeq: { increment: 1 } },
          select: { defectSeq: true },
        });
        const defect = await tx.defect.create({
          data: {
            projectId: project.id,
            seq: defectSeq,
            code: `${project.key}-${defectSeq}`,
            title: TITLES[i % TITLES.length]!,
            description: '（演示数据，由 scripts/demo-defects.ts 生成，可删除）',
            steps: '1. 打开 APP 并登录\n2. 按标题描述的场景操作\n3. 观察页面表现',
            expected: '功能表现正常',
            actual: TITLES[i % TITLES.length]!,
            status: state.key,
            statusCategory: category,
            severity,
            severityRank: SEVERITY_RANK[severity],
            priority,
            priorityRank: priority ? PRIORITY_RANK[priority] : null,
            frequency: FREQUENCIES[i % FREQUENCIES.length],
            moduleId: module?.id,
            ownerIds: owner ? [owner.userId] : [],
            reporterId: reporter.userId,
            verifierId: reporter.userId,
            developerId: category === 'todo' ? null : (owner?.userId ?? null),
            source: i % 5 === 4 ? 'app' : 'web',
            createdAt,
            updatedAt: later(category === 'todo' ? 0 : 6),
            confirmedAt: category === 'todo' ? null : later(1),
            startedAt: category === 'todo' ? null : later(2),
            resolvedAt: category === 'verifying' || category === 'done' ? later(5) : null,
            closedAt: category === 'done' ? later(6) : null,
            reopenCount: state.key === 'reopened' ? 1 : 0,
          },
        });
        await tx.defectHistory.create({
          data: {
            defectId: defect.id,
            field: 'created',
            newValue: defect.code,
            operatorId: reporter.userId,
            via: 'web',
            createdAt,
          },
        });
        if (state.key !== initial.key) {
          await tx.defectHistory.create({
            data: {
              defectId: defect.id,
              field: 'status',
              oldValue: initial.key,
              newValue: state.key,
              operatorId: owner?.userId ?? reporter.userId,
              via: 'web',
              createdAt: later(2),
            },
          });
        }
        console.log(
          `${defect.code}  ${state.name.padEnd(5, '　')}  ${severity.padEnd(8)} ${(priority ?? '-').padEnd(13)} ${
            owner?.user.name ?? '未指派'
          }  ${defect.title}`,
        );
      });
    }
    console.log(`已在项目 ${project.key} 生成 ${count} 个演示缺陷`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
