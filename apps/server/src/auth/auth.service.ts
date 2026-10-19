import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import type { AuthUser } from '../common/auth-user';
import { generateApiToken, sha256Hex } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';

interface JwtPayload {
  sub: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string): Promise<{ accessToken: string; user: AuthUser }> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    // 用户不存在时也做一次哈希比较，避免通过响应时间探测账号是否存在
    const hash =
      user?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
    const ok = await bcrypt.compare(password, hash);
    if (!user || !ok || user.disabledAt) throw new UnauthorizedException('邮箱或密码错误');
    const accessToken = await this.jwt.signAsync({ sub: user.id } satisfies JwtPayload);
    return { accessToken, user: this.toAuthUser(user, 'jwt', false) };
  }

  /** 解析 Authorization: Bearer 后的凭证，支持登录 JWT 与个人 API Token（dp_ 开头）。 */
  async authenticate(credential: string): Promise<AuthUser | null> {
    if (credential.startsWith('dp_')) return this.authenticateApiToken(credential);
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(credential);
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || user.disabledAt) return null;
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
    if (!record || record.revokedAt || record.user.disabledAt) return null;
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

  static hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  private toAuthUser(
    user: { id: string; email: string; name: string; isSystemAdmin: boolean },
    via: AuthUser['via'],
    readOnly: boolean,
  ): AuthUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isSystemAdmin: user.isSystemAdmin,
      via,
      readOnly,
    };
  }
}
