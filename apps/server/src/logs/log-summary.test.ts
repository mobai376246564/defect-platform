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

  it('does not repeat the error block in the tail section', () => {
    const { summary } = summarizeLogs([{ name: 'app.log', text: androidLog }]);
    expect(summary.match(/FATAL EXCEPTION/g)).toHaveLength(1);
    expect(summary.match(/OrderDetailActivity\.refresh/g)).toHaveLength(1);
    // 末尾片段只补充没列出的上下文
    expect(summary).toContain('末尾 2 行（不含上面已列出的）');
    expect(summary).toContain('I/OrderPage: onResume');
  });

  it('merges errors that only differ in timestamps or numbers, keeping the latest', () => {
    const lines = Array.from(
      { length: 50 },
      (_, i) => `10-16 10:21:${String(i).padStart(2, '0')}.100 E/Net: timeout after ${3000 + i}ms`,
    );
    lines.splice(30, 0, '10-16 10:21:30.500 E/Pay: signature mismatch');
    const { summary } = summarizeLogs([{ name: 'net.log', text: lines.join('\n') }]);
    expect(summary).toContain('51 处异常相关日志（2 种）');
    expect(summary).toContain('以下错误共出现 50 次，首次第 1 行，最近第 51 行');
    expect(summary).toContain('timeout after 3049ms');
    expect(summary).not.toContain('timeout after 3000ms');
    expect(summary).toContain('E/Pay: signature mismatch');
    expect(summary.length).toBeLessThan(400);
  });

  it('recognises logcat threadtime levels and iOS crashes', () => {
    const text = [
      '10-16 10:21:01.100  1234  1234 I ActivityManager: Start proc 1234',
      '10-16 10:21:02.200  1234  1234 E AndroidRuntime: Process: com.example, PID: 1234',
      'Fatal error: Unexpectedly found nil while unwrapping an Optional value',
      "*** Terminating app due to uncaught exception 'NSInvalidArgumentException', reason: bad",
      'normal line',
    ].join('\n');
    const { summary, exception } = summarizeLogs([{ name: 'mixed.log', text }]);
    // 紧跟在 Fatal error 后、带异常名的一行归入同一段
    expect(summary).toContain('2 处异常相关日志');
    expect(summary).toContain('E AndroidRuntime: Process');
    expect(summary).toContain('Fatal error: Unexpectedly found nil');
    expect(summary).toContain('Terminating app due to uncaught exception');
    expect(exception?.type).toBe('NSInvalidArgumentException');
    // 普通的 I 级别日志不算错误，只出现在末尾片段里
    expect(summary.split('末尾')[0]).not.toContain('Start proc');
  });

  it('reads "time|level|message" client logs by their level field', () => {
    const unityLog = [
      ' 17:33:56.418|L|[GameStart] 开始',
      '17:33:59.098|W|[xasset] <Error> Initialize with: Success .',
      '17:34:01.677|E|Object reference not set to an instance of an object.',
      '17:34:02.000|L|获取配置信息 {"result":0,',
      '  "data": {"error": "not an error line"}',
      '}',
      '17:34:11.675|E|图片加载失败: URL=https://cdn.example.com/a/105.png?x=1, error:404 Not Found',
      '17:36:03.943|E|图片加载失败: URL=https://cdn.example.com/b/1.png, error:404 Not Found',
      '17:40:00.000|E|NullReferenceException: Object reference not set to an instance of an object',
      '  at Game.UI.ShopPanel.Refresh () [0x00012] in <a1b2c3>:0',
      '  at Game.UI.ShopPanel.OnEnable () [0x00000] in <a1b2c3>:0',
      `17:41:00.000|L|${'x'.repeat(2000)}`,
    ].join('\n');
    const { summary, exception } = summarizeLogs([{ name: 'game.log', text: unityLog }]);
    const errors = summary.split('末尾')[0]!;
    // W 级别里的 “<Error>” 和 JSON 续行里的 error 字样都不算错误
    expect(errors).not.toContain('Initialize with');
    expect(errors).not.toContain('not an error line');
    expect(errors).toContain('Object reference not set');
    // 只有图片地址不同的错误合并为一种
    expect(summary).toContain('以下错误共出现 2 次');
    // 错误后面没有时间前缀的续行（C# 堆栈）归入同一段，并用于去重指纹
    expect(errors).toContain('at Game.UI.ShopPanel.Refresh ()');
    expect(exception).toEqual({
      type: 'NullReferenceException',
      frames: [
        'at Game.UI.ShopPanel.Refresh () [0x00012] in <a1b2c3>:0',
        'at Game.UI.ShopPanel.OnEnable () [0x00000] in <a1b2c3>:0',
      ],
    });
    // 超长行截断显示
    expect(summary).toContain('…（共 2015 字）');
  });

  it('does not fingerprint a bare exception message without a stack', () => {
    const log = [
      '17:33:56.418|L|start',
      '17:34:01.677|E|Object reference not set to an instance of an object.',
      '17:34:02.000|L|next',
    ].join('\n');
    const { summary, exception } = summarizeLogs([{ name: 'game.log', text: log }]);
    expect(summary).toContain('Object reference not set');
    // 每次启动都可能出现的同一句空引用，不能用它把不同反馈合并成一个缺陷
    expect(exception).toBeUndefined();
  });

  it('truncates to the requested size, keeping the end', () => {
    // 用字母区分每条错误，避免被当作重复错误合并
    const word = (i: number) => i.toString(26).replace(/\d/g, (d) => 'qrstuvwxyz'[Number(d)]!);
    const big = Array.from({ length: 2000 }, (_, i) => `E/Tag: error ${word(i)}`).join('\n');
    const { summary } = summarizeLogs([{ name: 'big.log', text: big }], 500);
    expect(summary.length).toBeLessThan(600);
    expect(summary).toContain('已截断');
    expect(summary).toContain(`error ${word(1999)}`);
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
