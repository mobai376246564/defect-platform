import { describe, expect, it } from 'vitest';
import { extractMentions } from './mentions';

const members = [
  { id: 'wang', name: '小王', email: 'wang@example.com' },
  { id: 'wangzi', name: '小王子', email: 'prince@example.com' },
  { id: 'li', name: 'Li Lei', email: 'li@example.com' },
];

describe('extractMentions', () => {
  it('finds names written right before Chinese text', () => {
    expect(extractMentions('@小王请看一下', members)).toEqual(['wang']);
  });

  it('prefers the longest matching name', () => {
    expect(extractMentions('@小王子 帮忙确认', members)).toEqual(['wangzi']);
  });

  it('matches emails case-insensitively and names with spaces', () => {
    expect(extractMentions('cc @LI@Example.com and @Li Lei', members)).toEqual(['li']);
  });

  it('ignores @ inside an email address and unknown names', () => {
    expect(extractMentions('发给 wang@example.com，@张三 看看', members)).toEqual([]);
  });

  it('deduplicates repeated mentions', () => {
    expect(extractMentions('@小王 @小王 @prince@example.com', members)).toEqual(['wang', 'wangzi']);
  });
});
