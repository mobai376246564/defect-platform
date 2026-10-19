import { describe, expect, it } from 'vitest';
import { errorMessage } from './client';

describe('errorMessage', () => {
  it('uses the server message and lists missing workflow fields', () => {
    expect(
      errorMessage({ message: '缺少流转必填字段', missing: ['priority', 'moduleId'] }, 'x'),
    ).toBe('缺少流转必填字段：缺少：priority、moduleId');
  });

  it('flattens zod issues and plain string issues', () => {
    expect(
      errorMessage({ message: '参数校验失败', issues: [{ path: 'title', message: '必填' }] }, 'x'),
    ).toBe('参数校验失败：title 必填');
    expect(errorMessage({ message: '工作流配置有误', issues: ['状态 key 重复：a'] }, 'x')).toBe(
      '工作流配置有误：状态 key 重复：a',
    );
  });

  it('falls back when the body has nothing useful', () => {
    expect(errorMessage(undefined, '请求失败（500）')).toBe('请求失败（500）');
    expect(errorMessage('<html>', '请求失败（502）')).toBe('请求失败（502）');
  });
});
