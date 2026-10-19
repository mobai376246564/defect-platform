import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKFLOW,
  availableTransitions,
  checkTransition,
  validateWorkflow,
  type WorkflowDefinition,
} from './workflow';

describe('DEFAULT_WORKFLOW', () => {
  it('passes its own validation', () => {
    expect(validateWorkflow(DEFAULT_WORKFLOW)).toEqual([]);
  });

  it('offers testers confirm/reject on a new defect, developers nothing', () => {
    const tester = availableTransitions(DEFAULT_WORKFLOW, 'new', 'tester').map((t) => t.key);
    expect(tester).toEqual(['confirm', 'reject']);
    expect(availableTransitions(DEFAULT_WORKFLOW, 'new', 'developer')).toEqual([]);
    expect(availableTransitions(DEFAULT_WORKFLOW, 'new', undefined)).toEqual([]);
  });
});

describe('checkTransition', () => {
  const base = { currentState: 'new', actor: 'tester' as const, values: {} };

  it('rejects unknown transitions', () => {
    expect(checkTransition(DEFAULT_WORKFLOW, { ...base, transitionKey: 'nope' })).toMatchObject({
      ok: false,
      reason: 'not_found',
    });
  });

  it('rejects a transition from the wrong state', () => {
    const r = checkTransition(DEFAULT_WORKFLOW, { ...base, transitionKey: 'verify' });
    expect(r).toMatchObject({ ok: false, reason: 'wrong_state' });
  });

  it('rejects roles that are not allowed', () => {
    const r = checkTransition(DEFAULT_WORKFLOW, {
      ...base,
      actor: 'developer',
      transitionKey: 'confirm',
      values: { priority: 'high', moduleId: 'm1' },
    });
    expect(r).toMatchObject({ ok: false, reason: 'forbidden' });
  });

  it('lists missing required fields', () => {
    const r = checkTransition(DEFAULT_WORKFLOW, {
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
    expect(checkTransition(DEFAULT_WORKFLOW, input)).toMatchObject({ reason: 'missing_comment' });
    expect(checkTransition(DEFAULT_WORKFLOW, { ...input, comment: '  ' })).toMatchObject({
      reason: 'missing_comment',
    });
    expect(checkTransition(DEFAULT_WORKFLOW, { ...input, comment: '仍然复现' }).ok).toBe(true);
  });

  it('lets the system bypass role checks', () => {
    const r = checkTransition(DEFAULT_WORKFLOW, {
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
