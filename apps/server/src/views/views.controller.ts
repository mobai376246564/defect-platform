import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { ProjectAccessService } from '../projects/project-access.service';
import { viewSchema, viewUpdateSchema, ViewsService, type ViewInput } from './views.service';

@Controller('projects/:key/views')
export class ViewsController {
  constructor(
    private readonly views: ViewsService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Param('key') key: string) {
    return this.views.list(await this.access.require(key, user, 'defect.view'), user);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Body(new ZodPipe(viewSchema)) body: ViewInput,
  ) {
    return this.views.create(await this.access.require(key, user, 'defect.view'), user, body);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('id') id: string,
    @Body(new ZodPipe(viewUpdateSchema)) body: Partial<ViewInput>,
  ) {
    const ctx = await this.access.require(key, user, 'defect.view');
    return this.views.update(ctx, user, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.views.remove(await this.access.require(key, user, 'defect.view'), user, id);
  }
}
