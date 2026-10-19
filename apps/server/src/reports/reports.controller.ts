import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { ProjectAccessService } from '../projects/project-access.service';
import { ReportsService, reportFilterSchema, type ReportFilter } from './reports.service';

const REPORTS = [
  'trend',
  'distribution',
  'age',
  'versions',
  'efficiency',
  'quality',
  'feedback',
  'claude',
] as const;
type ReportName = (typeof REPORTS)[number];

/** 统计报表（方案 6.9）：GET /projects/:key/reports/:name，所有项目成员可查看。 */
@Controller('projects/:key/reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get(':name')
  async report(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('name') name: string,
    @Query(new ZodPipe(reportFilterSchema)) filter: ReportFilter,
  ) {
    if (!(REPORTS as readonly string[]).includes(name)) {
      throw new NotFoundException(`报表 ${name} 不存在`);
    }
    const ctx = await this.access.require(key, user, 'report.view');
    return this.reports[name as ReportName](ctx, filter);
  }
}
