import { describe, expect, it } from 'vitest';
import { matchAppBinding } from './app-binding';

const projects = [
  { name: '盒子', appIds: ['BudBox'] },
  { name: '盒子 iOS 测试渠道', appIds: ['com.pointone.iosBudBox.beta'] },
  { name: '商城', appIds: ['com.bud.shop'] },
];

describe('matchAppBinding', () => {
  it('matches keywords contained in the appId, ignoring case', () => {
    expect(matchAppBinding(projects, 'com.pointone.androidbudbox')).toEqual({
      project: projects[0],
    });
    expect(matchAppBinding(projects, 'COM.BUD.SHOP')).toEqual({ project: projects[2] });
    expect(matchAppBinding(projects, 'com.other.app')).toBeNull();
  });

  it('prefers the longest matching keyword', () => {
    expect(matchAppBinding(projects, 'com.pointone.iosBudBox.beta')).toEqual({
      project: projects[1],
    });
  });

  it('reports a tie between projects as ambiguous', () => {
    const tie = [
      { name: '甲', appIds: ['abc'] },
      { name: '乙', appIds: ['xyz'] },
    ];
    expect(matchAppBinding(tie, 'abc.xyz')).toEqual({ ambiguous: ['甲', '乙'] });
  });
});
