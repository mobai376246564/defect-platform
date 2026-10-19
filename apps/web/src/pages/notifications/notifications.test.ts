import { describe, expect, it } from 'vitest';
import { notificationLink, notificationTime } from './notifications';

describe('notificationLink', () => {
  it('links to the defect, the project, or nowhere', () => {
    expect(notificationLink({ projectKey: 'APP', defectCode: 'APP-3' })).toBe('/p/APP/bugs/APP-3');
    expect(notificationLink({ projectKey: 'APP', defectCode: null })).toBe('/p/APP/bugs');
    expect(notificationLink({ projectKey: null, defectCode: 'APP-3' })).toBeNull();
  });
});

describe('notificationTime', () => {
  const now = new Date(2026, 9, 19, 15, 0);
  it('uses relative day names for today and yesterday', () => {
    expect(notificationTime(new Date(2026, 9, 19, 9, 5).toISOString(), now)).toBe('今天 09:05');
    expect(notificationTime(new Date(2026, 9, 18, 23, 59).toISOString(), now)).toBe('昨天 23:59');
  });

  it('shows month-day this year and the full date before', () => {
    expect(notificationTime(new Date(2026, 9, 17, 8, 0).toISOString(), now)).toBe('10-17 08:00');
    expect(notificationTime(new Date(2025, 11, 31, 8, 0).toISOString(), now)).toBe(
      '2025-12-31 08:00',
    );
  });
});
