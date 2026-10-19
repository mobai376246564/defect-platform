import { All, Controller, Post, Req, Res } from '@nestjs/common';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import type { AuthedRequest } from '../common/auth-user';
import { McpServerFactory } from './mcp-server.factory';

/**
 * MCP 端点（Streamable HTTP，无状态模式）。
 * 本地 Claude Code 接入：
 *   claude mcp add --transport http defects <平台地址>/api/v1/mcp --header "Authorization: Bearer <个人 Token>"
 */
@Controller('mcp')
export class McpController {
  constructor(private readonly factory: McpServerFactory) {}

  @Post()
  async handle(@Req() req: AuthedRequest, @Res() res: Response): Promise<void> {
    const server = this.factory.create(req.user!);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  /** 无状态模式不支持 SSE 推送与会话删除 */
  @All()
  notAllowed(@Req() _req: Request, @Res() res: Response): void {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed' },
      id: null,
    });
  }
}
