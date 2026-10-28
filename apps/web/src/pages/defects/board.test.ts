import { CLASSIC_WORKFLOW, DEFAULT_WORKFLOW } from '@defect/shared';
import { describe, expect, it } from 'vitest';
import type { DefectRow } from '../../api/types';
import { boardColumns, dropTransition, needsForm } from './board';

const row = (over: Partial<DefectRow>): DefectRow => ({
  id: over.code ?? 'x',
  code: 'APP-1',
  title: 't',
  status: 'new',
  statusCategory: 'todo',
  severity: 'normal',
  priority: null,
  moduleId: null,
  ownerIds: [],
  reporterId: null,
  source: 'web',
  dueAt: null,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...over,
});

const transition = (key: string) => CLASSIC_WORKFLOW.transitions.find((t) => t.key === key)!;

describe('boardColumns', () => {
  it('makes one column per workflow state, most severe and most recent first', () => {
    const cols = boardColumns(CLASSIC_WORKFLOW, [
      row({ code: 'A', severity: 'normal', updatedAt: '2026-10-03T00:00:00Z' }),
      row({ code: 'B', severity: 'fatal' }),
      row({ code: 'C', severity: 'normal', updatedAt: '2026-10-05T00:00:00Z' }),
      row({ code: 'D', status: 'closed', statusCategory: 'done' }),
      row({ code: 'E', status: 'gone' }),
    ]);
    expect(cols.map((c) => c.key)).toEqual(CLASSIC_WORKFLOW.states.map((s) => s.key));
    expect(cols[0]!.items.map((d) => d.code)).toEqual(['B', 'C', 'A']);
    expect(cols.find((c) => c.key === 'closed')!.items.map((d) => d.code)).toEqual(['D']);
  });
});

describe('dropTransition', () => {
  it('allows only transitions the role may perform', () => {
    expect(dropTransition(CLASSIC_WORKFLOW, 'tester', 'new', 'confirmed')?.key).toBe('confirm');
    expect(dropTransition(CLASSIC_WORKFLOW, 'developer', 'new', 'confirmed')).toBeNull();
    expect(dropTransition(CLASSIC_WORKFLOW, 'developer', 'confirmed', 'in_progress')?.key).toBe(
      'start',
    );
    expect(dropTransition(CLASSIC_WORKFLOW, 'admin', 'new', 'closed')).toBeNull();
    expect(dropTransition(CLASSIC_WORKFLOW, 'admin', 'new', 'new')).toBeNull();
    expect(dropTransition(CLASSIC_WORKFLOW, undefined, 'new', 'confirmed')).toBeNull();
  });

  it('lets editors drag to any column in the free workflow', () => {
    const t = dropTransition(DEFAULT_WORKFLOW, 'developer', 'pending', 'passed');
    expect(t).toMatchObject({ key: 'to_passed', to: 'passed' });
    expect(t && needsForm(t, row({}))).toBe(false);
    expect(dropTransition(DEFAULT_WORKFLOW, 'viewer', 'pending', 'passed')).toBeNull();
  });
});

describe('needsForm', () => {
  it('opens the form for missing required fields or a required comment', () => {
    expect(needsForm(transition('confirm'), row({}))).toBe(true);
    expect(needsForm(transition('confirm'), row({ priority: 'high', moduleId: 'm' }))).toBe(false);
    expect(needsForm(transition('reopen'), row({}))).toBe(true);
    // 看板行没有“解决方法”，拒绝时需要补填
    expect(needsForm(transition('reject'), row({}))).toBe(true);
    expect(needsForm(transition('start'), row({}))).toBe(false);
  });
});
