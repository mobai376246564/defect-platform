import { sha256Hex } from '../common/crypto';
import type { LogFile } from './log-archive';

/**
 * 错误行：大写级别关键字、Android logcat 的 E/F 级别（E/Tag: 与 threadtime 格式的 “ E Tag:”）、
 * 异常名、iOS / Swift 的崩溃提示与信号。
 */
const ERROR_LINE = new RegExp(
  [
    String.raw`FATAL|ERROR|Exception\b|Error:|Caused by:|SIGABRT|SIGSEGV|SIGBUS|\bANR\b`,
    String.raw`\b[EF]\/[\w.$-]+`,
    String.raw`\s[EF]\s+[\w.$-]+\s*:`,
    String.raw`^\s*[EF]\s`,
    String.raw`[Ff]atal error:|Terminating app due to uncaught exception|Thread \d+ Crashed`,
  ].join('|'),
);
const STACK_FRAME = /^\s+at\s+[\w$.<>]+\(.*\)|^\s*\d+\s+\S+\s+0x[0-9a-f]+/i;
const EXCEPTION_HEAD =
  /(?:^|\s)((?:[a-zA-Z_$][\w$]*\.)+[A-Z][\w$]*(?:Exception|Error))\b|((?:NS|Swift)\w*(?:Exception|Error))/;
/** 行首的日期、时间、进程号等，比较两段错误是否“相同”时忽略 */
const VOLATILE = /\d+/g;
/** 每个文件最多列出的不同错误段数 */
const MAX_BLOCKS = 40;
const TAIL_LINES = 20;

export interface LogSummary {
  /** 写入缺陷“日志摘要”字段的文本 */
  summary: string;
  /** 第一个异常的类型与栈顶帧，用于去重指纹 */
  exception?: { type: string; frames: string[] };
}

interface ErrorBlock {
  /** 最近一次出现时的行（带行号） */
  lines: string[];
  first: number;
  last: number;
  count: number;
}

/**
 * 规则提取，不调用大模型（方案 5.2 第 6 步）：
 * 1. 找出错误行，连同紧随其后的异常头、Caused by 与堆栈帧组成一段；
 * 2. 只有时间、行号等数字不同的重复错误合并为一段，标出出现次数，展示最近一次；
 * 3. 附上日志末尾片段（跳过已经列出的行），便于看到崩溃前后的上下文。
 * 摘要控制在约 8 KB 内，完整日志由 Claude Code 通过 MCP grep_log / read_log 按需读取。
 */
export function summarizeLogs(files: LogFile[], maxChars = 8000): LogSummary {
  const parts: string[] = [];
  let exception: LogSummary['exception'];

  for (const f of files) {
    const lines = f.text.split(/\r?\n/);
    const blocks = new Map<string, ErrorBlock>();
    const picked = new Set<number>();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (!ERROR_LINE.test(line)) continue;
      const block = [line];
      const numbered = [`${i + 1}: ${line}`];
      const frames: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j] ?? '';
        const isFrame = STACK_FRAME.test(next);
        if (!isFrame && !/^\s*Caused by:/.test(next) && !EXCEPTION_HEAD.test(next)) break;
        block.push(next);
        numbered.push(`${j + 1}: ${next}`);
        if (isFrame) frames.push(next.trim());
        j++;
      }
      for (let k = i; k < j; k++) picked.add(k);
      if (!exception) {
        for (const l of block) {
          const head = EXCEPTION_HEAD.exec(l);
          const type = head?.[1] ?? head?.[2];
          if (type) {
            exception = { type, frames: frames.slice(0, 5) };
            break;
          }
        }
      }
      const key = block.join('\n').replace(VOLATILE, '#');
      const seen = blocks.get(key);
      if (seen) {
        seen.count++;
        seen.last = i + 1;
        seen.lines = numbered;
      } else {
        blocks.set(key, { lines: numbered, first: i + 1, last: i + 1, count: 1 });
      }
      i = j - 1;
    }

    if (blocks.size > 0) {
      const all = [...blocks.values()];
      // 错误段太多时保留最后的（离崩溃最近）
      const shown = all.slice(-MAX_BLOCKS);
      const total = all.reduce((n, b) => n + b.count, 0);
      parts.push(
        `== ${f.name}：${total} 处异常相关日志${all.length < total ? `（${all.length} 种）` : ''} ==`,
      );
      if (shown.length < all.length)
        parts.push(`…（较早的 ${all.length - shown.length} 种已省略）`);
      for (const b of shown) {
        if (b.count > 1) {
          parts.push(`（以下错误共出现 ${b.count} 次，首次第 ${b.first} 行，最近第 ${b.last} 行）`);
        }
        parts.push(...b.lines);
      }
    }

    // 末尾片段：只列出上面没出现过的行；整个文件都已列出时不再重复
    const tail = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.trim())
      .slice(-TAIL_LINES)
      .filter(({ i }) => !picked.has(i));
    if (tail.length > 0) {
      parts.push(
        `== ${f.name}：末尾 ${tail.length} 行${picked.size ? '（不含上面已列出的）' : ''} ==`,
        ...tail.map(({ l }) => l),
      );
    }
  }

  let summary = parts.join('\n');
  if (summary.length > maxChars) summary = `…（已截断，仅保留末尾）\n${summary.slice(-maxChars)}`;
  return { summary, exception };
}

/** 去重指纹：异常类型 + 栈顶 5 帧 + 大版本号（方案 5.2 第 7 步）。 */
export function fingerprintOf(
  exception: LogSummary['exception'],
  appVersion: string,
): string | null {
  if (!exception) return null;
  const major = appVersion.split('.')[0] ?? appVersion;
  const frames = exception.frames.map((f) => f.replace(/:\d+\)/, ')')); // 去掉行号，避免小改动导致指纹变化
  return sha256Hex([exception.type, ...frames, major].join('|')).slice(0, 32);
}
