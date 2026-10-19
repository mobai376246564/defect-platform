import { describe, expect, it } from 'vitest';
import { feedbackManifestSchema, feedbackPrefix, parseManifestKey } from './manifest';

const reportId = '0192f3c4-7a1b-7c3d-9e8f-1a2b3c4d5e6f';

const valid = {
  schemaVersion: 1,
  reportId,
  appId: 'com.example.app',
  title: '支付成功后订单页仍显示待支付',
  app: { version: '3.12.0', build: '31200', commit: 'a1b2c3d' },
  attachments: [{ key: 'logs.zip', type: 'log', size: 100 }],
  createdAt: '2026-10-16T10:21:33+08:00',
};

describe('feedbackManifestSchema', () => {
  it('accepts a valid manifest and fills defaults', () => {
    const m = feedbackManifestSchema.parse(valid);
    expect(m.description).toBe('');
    expect(m.device).toEqual({});
    expect(m.attachments).toHaveLength(1);
  });

  it('keeps unknown fields for forward compatibility', () => {
    const m = feedbackManifestSchema.parse({ ...valid, futureField: 42 });
    expect((m as Record<string, unknown>).futureField).toBe(42);
  });

  it('rejects attachment keys that escape the report directory', () => {
    const bad = { ...valid, attachments: [{ key: '../other/logs.zip', type: 'log', size: 1 }] };
    expect(feedbackManifestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects unknown schema versions', () => {
    expect(feedbackManifestSchema.safeParse({ ...valid, schemaVersion: 2 }).success).toBe(false);
  });
});

describe('parseManifestKey', () => {
  it('extracts app, date and report id', () => {
    expect(parseManifestKey(`feedback/com.example.app/20261016/${reportId}/manifest.json`)).toEqual(
      {
        appId: 'com.example.app',
        date: '20261016',
        reportId,
        prefix: `feedback/com.example.app/20261016/${reportId}/`,
      },
    );
  });

  it('returns null for anything else', () => {
    expect(parseManifestKey(`feedback/com.example.app/20261016/${reportId}/logs.zip`)).toBeNull();
    expect(parseManifestKey('web/APP/BUG-1/manifest.json')).toBeNull();
  });

  it('round-trips with feedbackPrefix', () => {
    const prefix = feedbackPrefix('com.example.app', new Date('2026-10-16T02:00:00Z'), reportId);
    expect(parseManifestKey(`${prefix}manifest.json`)?.prefix).toBe(prefix);
  });
});
