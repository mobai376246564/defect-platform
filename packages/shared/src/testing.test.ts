import { describe, expect, it } from 'vitest';
import {
  inferTestCaseMode,
  sheetStats,
  summarizeTestPoints,
  testModeFromLabel,
  testResultFromLabel,
} from './testing';

const c = (
  code: string,
  sheet: string,
  testPoint: string,
  priority = 'P1',
  result = 'pending',
) => ({
  code,
  sheet,
  module: sheet,
  subModule: '子',
  testPoint,
  priority,
  result,
});

describe('test suite helpers', () => {
  it('groups test points by sheet order then first appearance', () => {
    const rows = summarizeTestPoints(
      [
        c('W-1', '天气', '显示'),
        c('H-1', '首页', '布局'),
        c('W-2', '天气', '显示'),
        c('W-3', '天气', '开关'),
      ],
      ['首页', '天气'],
    );
    expect(rows.map((r) => [r.testPoint, r.codes])).toEqual([
      ['布局', ['H-1']],
      ['显示', ['W-1', 'W-2']],
      ['开关', ['W-3']],
    ]);
  });

  it('counts priorities and results per sheet', () => {
    const [weather] = sheetStats(
      [
        c('W-1', '天气', 'a', 'P0', 'passed'),
        c('W-2', '天气', 'a', 'P0', 'failed'),
        c('W-3', '天气', 'b'),
      ],
      ['天气'],
    );
    expect(weather).toEqual({
      sheet: '天气',
      total: 3,
      priority: { P0: 2, P1: 1 },
      result: { passed: 1, failed: 1, pending: 1 },
    });
  });

  it('maps Excel labels back to keys', () => {
    expect(testResultFromLabel('通过')).toBe('passed');
    expect(testResultFromLabel(' 不适用 ')).toBe('na');
    expect(testResultFromLabel('')).toBe('pending');
    expect(testModeFromLabel('人工')).toBe('manual');
    expect(testModeFromLabel('')).toBeNull();
    expect(inferTestCaseMode('硬件')).toBe('manual');
    expect(inferTestCaseMode('功能')).toBe('auto');
  });
});
