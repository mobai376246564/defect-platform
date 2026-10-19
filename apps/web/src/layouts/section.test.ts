import { describe, expect, it } from 'vitest';
import { menuSection } from './section';

describe('menuSection', () => {
  it.each([
    ['/p/APP/bugs', 'bugs'],
    ['/p/APP/bugs/APP-12', 'bugs'],
    ['/p/APP/bugs/board', 'board'],
    ['/p/APP/bugs/new', 'new'],
    ['/p/APP/reports', 'reports'],
    ['/p/APP/settings', 'settings'],
  ])('%s → %s', (path, section) => {
    expect(menuSection(path)).toBe(section);
  });
});
