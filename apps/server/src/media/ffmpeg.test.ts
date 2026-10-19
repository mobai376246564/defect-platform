import { describe, expect, it } from 'vitest';
import { planFrameTimes } from './ffmpeg';

describe('planFrameTimes', () => {
  it('samples a short video once per second', () => {
    const plan = planFrameTimes(5);
    expect(plan.map((p) => p.tsMs)).toEqual([0, 1000, 2000, 3000, 4000]);
    expect(plan.every((p) => !p.nearMark)).toBe(true);
  });

  it('caps uniform sampling for long videos', () => {
    expect(planFrameTimes(600).length).toBeLessThanOrEqual(33);
  });

  it('adds dense frames around the marked moment and flags them', () => {
    const plan = planFrameTimes(120, 60_000);
    const near = plan.filter((p) => p.nearMark).map((p) => p.tsMs);
    expect(near).toContain(60_000);
    expect(near.length).toBeGreaterThanOrEqual(10);
    expect(Math.min(...near)).toBeGreaterThanOrEqual(55_000);
    expect(Math.max(...near)).toBeLessThanOrEqual(65_000);
  });

  it('never returns two frames closer than 500 ms', () => {
    const plan = planFrameTimes(40, 20_300);
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i]!.tsMs - plan[i - 1]!.tsMs).toBeGreaterThanOrEqual(500);
    }
  });
});
