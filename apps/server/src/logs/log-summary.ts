import { sha256Hex } from '../common/crypto';
import type { LogFile } from './log-archive';

const ERROR_LINE =
  /(FATAL|ERROR|\bE\/|Exception\b|Error:|Caused by:|SIGABRT|SIGSEGV|\bANR\b)|^\s*E\s/;
const STACK_FRAME = /^\s+at\s+[\w$.<>]+\(.*\)|^\s*\d+\s+\S+\s+0x[0-9a-f]+/i;
const EXCEPTION_HEAD =
  /(?:^|\s)((?:[a-zA-Z_$][\w$]*\.)+[A-Z][\w$]*(?:Exception|Error))\b|((?:NS|Swift)\w*(?:Exception|Error))/;

export interface LogSummary {
  /** 写入缺陷“日志摘要”字段的文本 */
  summary: string;
  /** 第一个异常的类型与栈顶帧，用于去重指纹 */
  exception?: { type: string; frames: string[] };
}

/**
 * 提取 ERROR/FATAL 行、异常堆栈与日志尾部片段（方案 5.2 第 6 步）。
 * 摘要控制在约 8 KB 内，完整日志通过 MCP grep_log / read_log 按需读取。
 */
export function summarizeLogs(files: LogFile[], maxChars = 8000): LogSummary {
  const parts: string[] = [];
  let exception: LogSummary['exception'];

  for (const f of files) {
    const lines = f.text.split(/\r?\n/);
    const picked: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (!ERROR_LINE.test(line)) continue;
      picked.push(`${i + 1}: ${line}`);
      // 带上紧随其后的异常头、Caused by 与堆栈帧
      const block = [line];
      const frames: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j] ?? '';
        const isFrame = STACK_FRAME.test(next);
        if (!isFrame && !/^\s*Caused by:/.test(next) && !EXCEPTION_HEAD.test(next)) break;
        picked.push(`${j + 1}: ${next}`);
        block.push(next);
        if (isFrame) frames.push(next.trim());
        j++;
      }
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
      i = j - 1;
    }
    if (picked.length > 0) {
      parts.push(`== ${f.name}：${picked.length} 行异常相关日志 ==`, ...picked.slice(-200));
    }
    const tail = lines.filter((l) => l.trim()).slice(-20);
    if (tail.length > 0) parts.push(`== ${f.name}：末尾 ${tail.length} 行 ==`, ...tail);
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
