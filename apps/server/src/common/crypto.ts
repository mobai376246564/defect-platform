import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hmacSha256Hex(secret: string, input: string): string {
  return createHmac('sha256', secret).update(input).digest('hex');
}

/** 常量时间比较，避免签名校验被时序攻击。 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** 生成个人 API Token：dp_ 前缀便于在日志与密钥扫描中识别。 */
export function generateApiToken(): { token: string; prefix: string; hash: string } {
  const token = `dp_${randomBytes(24).toString('base64url')}`;
  return { token, prefix: token.slice(0, 10), hash: sha256Hex(token) };
}
