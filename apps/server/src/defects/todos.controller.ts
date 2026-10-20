import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { DefectBulkService } from './defect-bulk.service';
import {
  todoGroupsSchema,
  todoQuerySchema,
  type TodoGroupsQuery,
  type TodoQuery,
} from './defects.dto';

/** 我的待办：跨项目列出指派给当前用户的缺陷（打开平台时的首页） */
@Controller('me/todos')
export class TodosController {
  constructor(private readonly bulk: DefectBulkService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(todoQuerySchema)) query: TodoQuery) {
    return this.bulk.todos(user, query);
  }

  @Get('groups')
  groups(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(todoGroupsSchema)) query: TodoGroupsQuery,
  ) {
    return this.bulk.todoGroups(user, query);
  }
}
