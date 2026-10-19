import { describe, expect, it } from 'vitest';
import { findDefectCodes } from './defect-refs';

describe('findDefectCodes', () => {
  it('finds codes in commit messages, branch names and MR titles', () => {
    expect(findDefectCodes('APP', 'fix(APP-12): 支付后刷新订单')).toEqual(['APP-12']);
    expect(findDefectCodes('APP', 'fix/APP-12-pay-refresh')).toEqual(['APP-12']);
    expect(findDefectCodes('APP', 'bugfix/app-7_order')).toEqual(['APP-7']);
    expect(findDefectCodes('APP', 'Fix APP-3, APP-4 and app-3')).toEqual(['APP-3', 'APP-4']);
    expect(findDefectCodes('APP', 'feat: x', null, undefined, 'fix(APP-012)')).toEqual(['APP-12']);
  });

  it('ignores other projects and partial matches', () => {
    expect(findDefectCodes('APP', 'fix(MYAPP-12): x')).toEqual([]);
    expect(findDefectCodes('APP', 'fix(WEB-12): x')).toEqual([]);
    expect(findDefectCodes('APP', 'APP-v2 APP- APP12')).toEqual([]);
  });
});
