import { Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('HTTP');
const SLOW_MS = 2000;

/**
 * 访问日志与请求 ID：每个请求带上 X-Request-Id（沿用上游传入的，否则生成一个），
 * 结束时记录方法、路径、状态码与耗时；5xx 记为错误、超过 2 秒的记为警告，排查问题时按 ID 串起来。
 * 路径不带查询串（附件下载链接的签名等不进日志）；健康检查不记录。
 */
export function requestLog() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.header('x-request-id');
    const id =
      incoming && /^[\w-]{1,64}$/.test(incoming) ? incoming : randomBytes(6).toString('hex');
    res.setHeader('X-Request-Id', id);
    const path = req.originalUrl.split('?')[0] ?? '';
    if (path.endsWith('/health')) return next();
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const user = (req as Request & { user?: { id?: string } }).user?.id;
      const line = `${id} ${req.method} ${path} ${res.statusCode} ${ms.toFixed(0)}ms${user ? ` user=${user}` : ''}`;
      if (res.statusCode >= 500) logger.error(line);
      else if (ms > SLOW_MS) logger.warn(`慢请求 ${line}`);
      else logger.log(line);
    });
    next();
  };
}
