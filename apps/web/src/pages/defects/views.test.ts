import { describe, expect, it } from 'vitest';
import { applySavedView, buildQuery, readSort, savedParams } from './views';

describe('buildQuery', () => {
  it('defaults to the open view with paging and sorting', () => {
    expect(buildQuery(new URLSearchParams())).toEqual({
      statusCategory: 'todo,doing,verifying',
      page: '1',
      pageSize: '20',
      sort: 'createdAt:desc',
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

  it('passes combined filters and multi-key sorting, and drops empty or broken filters', () => {
    const filters = {
      logic: 'or',
      conditions: [{ field: 'severity', op: 'in', value: ['fatal'] }],
    };
    const params = new URLSearchParams();
    params.set('filters', JSON.stringify(filters));
    params.set('sort', 'severity:desc,createdAt:asc,bogus:asc');
    const q = buildQuery(params);
    expect(JSON.parse(q.filters!)).toEqual(filters);
    expect(q.sort).toBe('severity:desc,createdAt:asc');

    expect(buildQuery(new URLSearchParams('filters={oops'))).not.toHaveProperty('filters');
    const empty = new URLSearchParams();
    empty.set('filters', JSON.stringify({ logic: 'and', conditions: [] }));
    expect(buildQuery(empty)).not.toHaveProperty('filters');
  });

  it('uses no built-in conditions for saved views', () => {
    const q = buildQuery(new URLSearchParams('view=saved:abc&priority=urgent'));
    expect(q).not.toHaveProperty('statusCategory');
    expect(q.priority).toBe('urgent');
  });

  it('reads legacy single-field sort links', () => {
    expect(readSort(new URLSearchParams('sort=seq&order=asc'))).toEqual([
      { field: 'seq', order: 'asc' },
    ]);
  });
});

describe('saved views', () => {
  it('stores filters, sort and grouping but not the view or paging', () => {
    const params = new URLSearchParams(
      'view=mine&severity=fatal&sort=priority:desc&groupBy=owner&page=4',
    );
    expect(savedParams(params)).toEqual({
      severity: 'fatal',
      sort: 'priority:desc',
      groupBy: 'owner',
    });
  });

  it('replaces current conditions when a saved view is applied', () => {
    const next = applySavedView(
      new URLSearchParams('view=mine&keyword=x&page=3&pageSize=50'),
      'v1',
      { severity: 'fatal', groupBy: 'status', evil: 'x' },
    );
    expect(Object.fromEntries(next)).toEqual({
      view: 'saved:v1',
      pageSize: '50',
      severity: 'fatal',
      groupBy: 'status',
    });
  });
});
