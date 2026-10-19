import { describe, expect, it } from 'vitest';
import { grepLogs } from './log-archive';
import { fingerprintOf, summarizeLogs } from './log-summary';

const androidLog = [
  '10-16 10:21:01.100 I/OrderPage: onResume',
  '10-16 10:21:02.200 E/AndroidRuntime: FATAL EXCEPTION: main',
  'java.lang.IllegalStateException: order status not refreshed',
  '    at com.example.order.OrderDetailActivity.refresh(OrderDetailActivity.kt:88)',
  '    at com.example.order.OrderDetailActivity.onResume(OrderDetailActivity.kt:42)',
  '10-16 10:21:03.000 I/App: shutting down',
].join('\n');

describe('summarizeLogs', () => {
  it('extracts the error line, its stack and the tail of the file', () => {
    const { summary, exception } = summarizeLogs([{ name: 'app.log', text: androidLog }]);
    expect(summary).toContain('FATAL EXCEPTION');
    expect(summary).toContain('OrderDetailActivity.refresh');
    expect(summary).toContain('shutting down');
    expect(exception?.type).toBe('java.lang.IllegalStateException');
  });

  it('truncates to the requested size, keeping the end', () => {
    const big = Array.from({ length: 2000 }, (_, i) => `E/Tag: error ${i}`).join('\n');
    const { summary } = summarizeLogs([{ name: 'big.log', text: big }], 500);
    expect(summary.length).toBeLessThan(600);
    expect(summary).toContain('error 1999');
  });
});

describe('fingerprintOf', () => {
  it('is stable across line-number changes and minor versions', () => {
    const a = fingerprintOf(
      { type: 'java.lang.NPE', frames: ['at a.B.c(B.kt:10)', 'at a.B.d(B.kt:20)'] },
      '3.12.0',
    );
    const b = fingerprintOf(
      { type: 'java.lang.NPE', frames: ['at a.B.c(B.kt:11)', 'at a.B.d(B.kt:25)'] },
      '3.13.1',
    );
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it('differs across major versions and returns null without an exception', () => {
    const e = { type: 'X', frames: [] };
    expect(fingerprintOf(e, '3.0')).not.toBe(fingerprintOf(e, '4.0'));
    expect(fingerprintOf(undefined, '3.0')).toBeNull();
  });
});

describe('grepLogs', () => {
  it('returns matches with merged context', () => {
    const { matches, truncated } = grepLogs(
      [{ name: 'app.log', text: androidLog }],
      /OrderDetail/i,
      {
        context: 1,
        maxMatches: 10,
      },
    );
    expect(truncated).toBe(false);
    expect(matches).toHaveLength(1);
    // 第 4、5 行命中，前后各 1 行上下文合并为一组
    expect(matches[0]?.map((m) => m.line)).toEqual([3, 4, 5, 6]);
  });

  it('stops at maxMatches', () => {
    const text = Array.from({ length: 20 }, () => 'hit').join('\n');
    const { truncated } = grepLogs([{ name: 'a', text }], /hit/, { context: 0, maxMatches: 5 });
    expect(truncated).toBe(true);
  });
});
