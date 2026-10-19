import { DEFAULT_WORKFLOW } from '@defect/shared';
import { describe, expect, it } from 'vitest';
import type { HistoryItem, ProjectDetail } from '../../api/types';
import { describeHistory } from './history';

const project = {
  workflow: DEFAULT_WORKFLOW,
  modules: [{ id: 'm1', name: '订单', parentId: null, ownerId: null }],
  versions: [],
  members: [{ id: 'u1', username: 'dev', name: '开发小李', email: 'd@x', role: 'developer' }],
} as unknown as ProjectDetail;

const h = (field: string, oldValue: unknown, newValue: unknown): HistoryItem => ({
  id: '1',
  field,
  oldValue,
  newValue,
  operatorId: null,
  via: 'web',
  createdAt: '2026-10-19T00:00:00Z',
});

describe('describeHistory', () => {
  it('translates status, enums, modules and owners into readable text', () => {
    expect(describeHistory(h('status', 'new', 'confirmed'), project)).toBe(
      '将状态从「新建」改为「已确认」',
    );
    expect(describeHistory(h('priority', null, 'high'), project)).toBe(
      '将优先级从「空」改为「高」',
    );
    expect(describeHistory(h('moduleId', null, 'm1'), project)).toBe('将模块从「空」改为「订单」');
    expect(describeHistory(h('ownerIds', [], ['u1', 'gone']), project)).toBe(
      '将处理人从「空」改为「开发小李、已移除成员」',
    );
  });

  it('summarises long text and special events', () => {
    expect(describeHistory(h('description', 'a', 'b'), project)).toBe('修改了描述');
    expect(describeHistory(h('created', null, 'APP-1'), project)).toBe('创建了缺陷');
    expect(describeHistory(h('link.branch', null, 'fix/APP-1'), project)).toBe(
      '关联了 branch：fix/APP-1',
    );
  });
});
