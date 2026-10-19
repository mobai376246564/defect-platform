import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { ProjectAccessService } from '../projects/project-access.service';
import {
  commentSchema,
  createDefectSchema,
  linkSchema,
  listQuerySchema,
  transitionSchema,
  updateDefectSchema,
  type CreateDefectInput,
  type LinkInput,
  type ListQuery,
  type TransitionInput,
  type UpdateDefectInput,
} from './defects.dto';
import { DefectsService, userActor, type Via } from './defects.service';

/** 个人 Token 调用的 REST 记为 api，网页登录调用记为 web */
const viaOf = (user: AuthUser): Via => (user.via === 'token' ? 'api' : 'web');

@Controller('projects/:key/defects')
export class DefectsController {
  constructor(
    private readonly defects: DefectsService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Query(new ZodPipe(listQuerySchema)) query: ListQuery,
  ) {
    const ctx = await this.access.require(key, user, 'defect.view');
    return this.defects.list(ctx, user, query);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Body(new ZodPipe(createDefectSchema)) body: CreateDefectInput,
  ) {
    const ctx = await this.access.require(key, user, 'defect.create');
    return this.defects.create(ctx, userActor(ctx, user), body, viaOf(user));
  }

  @Get(':code')
  async detail(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('code') code: string,
  ) {
    const ctx = await this.access.require(key, user, 'defect.view');
    return this.defects.detail(ctx, code);
  }

  @Patch(':code')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('code') code: string,
    @Body(new ZodPipe(updateDefectSchema)) body: UpdateDefectInput,
  ) {
    const ctx = await this.access.require(key, user, 'defect.edit');
    return this.defects.update(ctx, userActor(ctx, user), code, body, viaOf(user));
  }

  @Delete(':code')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('code') code: string,
  ): Promise<void> {
    const ctx = await this.access.require(key, user, 'defect.delete');
    await this.defects.softDelete(ctx, user, code);
  }

  @Post(':code/transitions')
  @HttpCode(200)
  async transition(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('code') code: string,
    @Body(new ZodPipe(transitionSchema)) body: TransitionInput,
  ) {
    const ctx = await this.access.require(key, user, 'defect.view');
    return this.defects.transition(ctx, userActor(ctx, user), code, body, viaOf(user));
  }

  @Post(':code/comments')
  async comment(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('code') code: string,
    @Body(new ZodPipe(commentSchema)) body: z.infer<typeof commentSchema>,
  ) {
    const ctx = await this.access.require(key, user, 'comment.create');
    return this.defects.addComment(ctx, userActor(ctx, user), code, body.body, viaOf(user));
  }

  @Post(':code/links')
  async link(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Param('code') code: string,
    @Body(new ZodPipe(linkSchema)) body: LinkInput,
  ) {
    const ctx = await this.access.require(key, user, 'defect.edit');
    return this.defects.addLink(ctx, userActor(ctx, user), code, body, viaOf(user));
  }
}
