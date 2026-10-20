import { describe, expect, it } from 'vitest';
import {
  CLASSIC_WORKFLOW,
  DEFAULT_WORKFLOW,
  availableTransitions,
  checkTransition,
  effectiveTransitions,
  freeTransitionKey,
  mergeTargetState,
  validateWorkflow,
  type WorkflowDefinition,
} from './workflow';

describe('DEFAULT_WORKFLOW (free)', () => {
  it('passes its own validation and starts at 待处理', () => {
    expect(validateWorkflow(DEFAULT_WORKFLOW)).toEqual([]);
    expect(DEFAULT_WORKFLOW.initialState).toBe('pending');
  });

  it('lets any editor move to any other state, but not viewers', () => {
    const keys = availableTransitions(DEFAULT_WORKFLOW, 'pending', 'developer').map((t) => t.to);
    expect(keys).toEqual(['in_progress', 'to_verify', 'passed', 'reopened', 'not_bug']);
    expect(availableTransitions(DEFAULT_WORKFLOW, 'pending', 'viewer')).toEqual([]);
    const ok = checkTransition(DEFAULT_WORKFLOW, {
      transitionKey: freeTransitionKey('passed'),
      currentState: 'pending',
      actor: 'tester',
      values: {},
    });
    expect(ok).toMatchObject({ ok: true, transition: { from: 'pending', to: 'passed' } });
    const same = checkTransition(DEFAULT_WORKFLOW, {
      transitionKey: freeTransitionKey('pending'),
      currentState: 'pending',
      actor: 'tester',
      values: {},
    });
    expect(same).toMatchObject({ ok: false, reason: 'wrong_state' });
  });

  it('derives assignment and reopen actions from category changes', () => {
    const t = (from: string, to: string) =>
      effectiveTransitions(DEFAULT_WORKFLOW).find((x) => x.from === from && x.to === to)!.actions;
    expect(t('pending', 'in_progress')).toEqual(['record_developer']);
    expect(t('in_progress', 'to_verify')).toEqual(['assign_to_verifier']);
    expect(t('to_verify', 'reopened')).toEqual(['assign_back_to_developer', 'increment_reopen']);
    expect(t('passed', 'pending')).toEqual(['assign_back_to_developer', 'increment_reopen']);
    expect(t('in_progress', 'passed')).toEqual([]);
  });

  it('follows state changes made by the admin immediately', () => {
    const custom: WorkflowDefinition = {
      ...DEFAULT_WORKFLOW,
      states: [
        ...DEFAULT_WORKFLOW.states.filter((s) => s.key !== 'not_bug'),
        { key: 'deferred', name: '延期处理', category: 'done', color: '#999' },
      ],
    };
    const targets = availableTransitions(custom, 'pending', 'tester').map((t) => t.label);
    expect(targets).toContain('延期处理');
    expect(targets).not.toContain('不是bug');
    expect(mergeTargetState(custom)?.key).toBe('to_verify');
    expect(mergeTargetState({ ...custom, mergeTarget: undefined })?.key).toBe('to_verify');
    expect(validateWorkflow({ ...custom, mergeTarget: 'nope' })).toContain(
      'MR 合并后的目标状态不存在：nope',
    );
    expect(
      validateWorkflow({ ...custom, states: custom.states.filter((s) => s.category !== 'done') }),
    ).toContain('至少需要一个“已完成”类别的状态');
  });
});

describe('CLASSIC_WORKFLOW (strict)', () => {
  it('passes its own validation', () => {
    expect(validateWorkflow(CLASSIC_WORKFLOW)).toEqual([]);
  });

  it('offers testers confirm/reject on a new defect, developers nothing', () => {
    const tester = availableTransitions(CLASSIC_WORKFLOW, 'new', 'tester').map((t) => t.key);
    expect(tester).toEqual(['confirm', 'reject']);
    expect(availableTransitions(CLASSIC_WORKFLOW, 'new', 'developer')).toEqual([]);
    expect(availableTransitions(CLASSIC_WORKFLOW, 'new', undefined)).toEqual([]);
  });
});

describe('checkTransition', () => {
  const base = { currentState: 'new', actor: 'tester' as const, values: {} };

  it('rejects unknown transitions', () => {
    expect(checkTransition(CLASSIC_WORKFLOW, { ...base, transitionKey: 'nope' })).toMatchObject({
      ok: false,
      reason: 'not_found',
    });
  });

  it('rejects a transition from the wrong state', () => {
    const r = checkTransition(CLASSIC_WORKFLOW, { ...base, transitionKey: 'verify' });
    expect(r).toMatchObject({ ok: false, reason: 'wrong_state' });
  });

  it('rejects roles that are not allowed', () => {
    const r = checkTransition(CLASSIC_WORKFLOW, {
      ...base,
      actor: 'developer',
      transitionKey: 'confirm',
      values: { priority: 'high', moduleId: 'm1' },
    });
    expect(r).toMatchObject({ ok: false, reason: 'forbidden' });
  });

  it('lists missing required fields', () => {
    const r = checkTransition(CLASSIC_WORKFLOW, {
      ...base,
      transitionKey: 'confirm',
      values: { priority: 'high' },
    });
    expect(r).toEqual({ ok: false, reason: 'missing_fields', missing: ['moduleId'] });
  });

  it('requires a comment when reopening', () => {
    const input = {
      transitionKey: 'reopen',
      currentState: 'resolved',
      actor: 'tester' as const,
      values: {},
    };
    expect(checkTransition(CLASSIC_WORKFLOW, input)).toMatchObject({ reason: 'missing_comment' });
    expect(checkTransition(CLASSIC_WORKFLOW, { ...input, comment: '  ' })).toMatchObject({
      reason: 'missing_comment',
    });
    expect(checkTransition(CLASSIC_WORKFLOW, { ...input, comment: '仍然复现' }).ok).toBe(true);
  });

  it('lets the system bypass role checks', () => {
    const r = checkTransition(CLASSIC_WORKFLOW, {
      transitionKey: 'merged',
      currentState: 'in_review',
      actor: 'system',
      values: {},
    });
    expect(r.ok).toBe(true);
  });
});

describe('validateWorkflow', () => {
  it('reports states that can never reach done', () => {
    const def: WorkflowDefinition = {
      initialState: 'a',
      states: [
        { key: 'a', name: 'A', category: 'todo', color: '#000' },
        { key: 'b', name: 'B', category: 'doing', color: '#000' },
        { key: 'z', name: 'Z', category: 'done', color: '#000' },
      ],
      transitions: [
        { key: 'ab', from: 'a', to: 'b', label: '', roles: ['admin'], requiredFields: [] },
        { key: 'az', from: 'a', to: 'z', label: '', roles: ['admin'], requiredFields: [] },
      ],
    };
    expect(validateWorkflow(def)).toEqual(['状态“B”无法到达已完成类别']);
  });

  it('reports dangling references and duplicate keys', () => {
    const def: WorkflowDefinition = {
      initialState: 'missing',
      states: [
        { key: 'a', name: 'A', category: 'done', color: '#000' },
        { key: 'a', name: 'A2', category: 'done', color: '#000' },
      ],
      transitions: [{ key: 't', from: 'a', to: 'x', label: '', roles: [], requiredFields: [] }],
    };
    const errors = validateWorkflow(def);
    expect(errors).toContain('状态 key 重复：a');
    expect(errors).toContain('初始状态不存在：missing');
    expect(errors).toContain('流转 t 的目标状态不存在：x');
  });
});
