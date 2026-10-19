import { describe, expect, it } from 'vitest';
import { buildQuery } from './views';

describe('buildQuery', () => {
  it('defaults to the open view with paging and sorting', () => {
    expect(buildQuery(new URLSearchParams())).toEqual({
      statusCategory: 'todo,doing,verifying',
      page: '1',
      pageSize: '20',
      sort: 'createdAt',
      order: 'desc',
    });
  });

  it('merges user filters over the selected view', () => {
    const q = buildQuery(
      new URLSearchParams('view=mine&severity=fatal,serious&keyword=登录&page=3'),
    );
    expect(q).toMatchObject({
      owner: 'me',
      statusCategory: 'todo,doing,verifying',
      severity: 'fatal,serious',
      keyword: '登录',
      page: '3',
    });
  });

  it('falls back to the default view for unknown keys and ignores unknown params', () => {
    const q = buildQuery(new URLSearchParams('view=nope&evil=1'));
    expect(q.statusCategory).toBe('todo,doing,verifying');
    expect(q).not.toHaveProperty('evil');
  });
});
