import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { USERNAME_PATTERN, type Position } from '@defect/shared';
import { z } from 'zod';
import type { AuthUser } from '../common/auth-user';
import { generateApiToken, sha256Hex } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';

interface JwtPayload {
  sub: string;
}

/** 新密码规则（bcrypt 只取前 72 字节，超出部分不参与校验）。 */
export const passwordSchema = z.string().min(8, '密码至少 8 位').max(72, '密码最多 72 位');

/** 登录账号规则，统一转小写存储。 */
export const usernameSchema = z
  .string()
  .trim()
  .regex(USERNAME_PATTERN, '账号为 3–32 位字母、数字、下划线、点或横线')
  .transform((v) => v.toLowerCase());

/** 未通过审核、被拒绝或已禁用的账号不能登录，也不能使用已有凭证。 */
function canSignIn(user: { status: string; disabledAt: Date | null }): boolean {
  return user.status === 'active' && !user.disabledAt;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** 账号或邮箱 + 密码登录。 */
  async login(account: string, password: string): Promise<{ accessToken: string; user: AuthUser }> {
    const key = account.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ username: key }, { email: key }] },
    });
    // 用户不存在时也做一次哈希比较，避免通过响应时间探测账号是否存在
    const hash =
      user?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
    const ok = await bcrypt.compare(password, hash);
    if (!user || !ok || user.disabledAt) throw new UnauthorizedException('账号或密码错误');
    // 密码正确后才提示审核状态，不向未持有密码的人暴露账号是否存在
    if (user.status === 'pending') throw new ForbiddenException('账号待管理员审核');
    if (user.status === 'rejected')
      throw new ForbiddenException('账号注册未通过审核，请联系管理员');
    const accessToken = await this.jwt.signAsync({ sub: user.id } satisfies JwtPayload);
    return { accessToken, user: this.toAuthUser(user, 'jwt', false) };
  }

  /** 解析 Authorization: Bearer 后的凭证，支持登录 JWT 与个人 API Token（dp_ 开头）。 */
  async authenticate(credential: string): Promise<AuthUser | null> {
    if (credential.startsWith('dp_')) return this.authenticateApiToken(credential);
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(credential);
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || !canSignIn(user)) return null;
      return this.toAuthUser(user, 'jwt', false);
    } catch {
      return null;
    }
  }

  private async authenticateApiToken(token: string): Promise<AuthUser | null> {
    const record = await this.prisma.apiToken.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: { user: true },
    });
    if (!record || record.revokedAt || !canSignIn(record.user)) return null;
    if (record.expiresAt && record.expiresAt < new Date()) return null;
    // 最近使用时间只用于展示，降低写入频率
    if (!record.lastUsedAt || Date.now() - record.lastUsedAt.getTime() > 60_000) {
      await this.prisma.apiToken.update({
        where: { id: record.id },
        data: { lastUsedAt: new Date() },
      });
    }
    return this.toAuthUser(record.user, 'token', record.readOnly);
  }

  async createApiToken(
    userId: string,
    input: { name: string; readOnly: boolean; expiresInDays?: number },
  ): Promise<{ id: string; token: string; prefix: string }> {
    const { token, prefix, hash } = generateApiToken();
    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 86_400_000)
      : null;
    const record = await this.prisma.apiToken.create({
      data: {
        userId,
        name: input.name,
        prefix,
        tokenHash: hash,
        readOnly: input.readOnly,
        expiresAt,
      },
    });
    return { id: record.id, token, prefix };
  }

  listApiTokens(userId: string) {
    return this.prisma.apiToken.findMany({
      where: { userId, revokedAt: null },
      select: {
        id: true,
        name: true,
        prefix: true,
        readOnly: true,
        expiresAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeApiToken(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.apiToken.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new NotFoundException('Token 不存在');
  }

  /** 自助注册：创建待审核账号，系统管理员通过后才能登录。 */
  async register(input: {
    username: string;
    password: string;
    position: Position;
    name?: string;
  }): Promise<{ id: string; username: string; status: string }> {
    const exists = await this.prisma.user.findFirst({
      where: { OR: [{ username: input.username }, { email: input.username }] },
    });
    if (exists) throw new ConflictException('账号已被使用');
    const user = await this.prisma.user.create({
      data: {
        username: input.username,
        name: input.name || input.username,
        position: input.position,
        status: 'pending',
        passwordHash: await AuthService.hashPassword(input.password),
      },
    });
    return { id: user.id, username: user.username, status: user.status };
  }

  /** 当前用户修改自己的密码，需校验旧密码。 */
  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash) throw new BadRequestException('该账号未设置本地密码');
    if (!(await bcrypt.compare(oldPassword, user.passwordHash))) {
      throw new BadRequestException('旧密码不正确');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await AuthService.hashPassword(newPassword) },
    });
  }

  static hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  private toAuthUser(
    user: {
      id: string;
      username: string;
      email: string | null;
      name: string;
      isSystemAdmin: boolean;
    },
    via: AuthUser['via'],
    readOnly: boolean,
  ): AuthUser {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      isSystemAdmin: user.isSystemAdmin,
      via,
      readOnly,
    };
  }
}
