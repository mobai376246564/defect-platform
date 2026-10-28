import { linesOf, type LogFile } from './log-archive';

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
/**
 * 带级别字段的行（Unity / 自研客户端常见）：“17:34:01.677|E|内容”、“[2026-10-19 17:34:01][E] 内容”。
 * 这类日志由级别决定是否算错误：E/F 等算，L/W/I/D 不算（W 行里的“<Error>”字样不是错误）。
 */
const LEVELED_LINE =
  /^\s*\[?(?:\d{4}[-/]\d{2}[-/]\d{2}[ T])?\d{2}:\d{2}:\d{2}(?:[.,]\d{1,6})?\]?\s*[|[]\s*([A-Za-z]{1,9})\s*[|\]]/;
const ERROR_LEVEL = /^(?:E|F|A|X|ERR|ERROR|FATAL|ASSERT|EXCEPTION|CRIT|CRITICAL)$/i;
/** 堆栈帧：Java / Kotlin、iOS，以及 C# / Unity（“at A.B () [0x0] in <x>:0”、“A.B:C (object)”、“A.B () (at Assets/x.cs:12)”） */
const STACK_FRAME =
  /^\s+at\s+[\w$.<>]+\(.*\)|^\s*\d+\s+\S+\s+0x[0-9a-f]+|^\s*(?:at\s+)?[\w.`<>+]+[.:][\w`<>]+\s*\([^)]*\)\s*(?:\[0x[0-9a-f]+\]|\(at\s|in\s|$)/i;
const EXCEPTION_HEAD =
  /(?:^|\s)((?:[a-zA-Z_$][\w$]*\.)+[A-Z][\w$]*(?:Exception|Error))\b|((?:NS|Swift)\w*(?:Exception|Error))/;
/** 每个文件最多列出的不同错误段数 */
const MAX_BLOCKS = 40;
const TAIL_LINES = 20;
/** 带级别的日志里，错误行后最多带上的续行（JSON 包体、堆栈） */
const MAX_CONTINUATION = 12;
/** 摘要里单行最多显示的字符数，超长的 JSON 行不至于挤占整个摘要 */
const MAX_LINE_CHARS = 400;

const clip = (s: string) =>
  s.length > MAX_LINE_CHARS ? `${s.slice(0, MAX_LINE_CHARS)}…（共 ${s.length} 字）` : s;

/**
 * 比较两段错误是否“相同”时忽略的部分：行首时间与级别、JSON 内容、网址、长随机 ID、数字。
 * 例如只有图片地址不同的“图片加载失败”合并为一种。
 */
function normalize(s: string): string {
  return s
    .replace(LEVELED_LINE, '')
    .replace(/\{.*\}/g, '{…}')
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\b[A-Za-z0-9_-]{16,}\b/g, '<id>')
    .replace(/\d+/g, '#');
}

/** 文件是否是“带级别字段”的格式：抽样开头的非空行，三成以上符合即可（其余多为 JSON 等续行） */
function isLeveled(lines: string[]): boolean {
  const sample = lines.filter((l) => l.trim()).slice(0, 300);
  return (
    sample.length > 0 && sample.filter((l) => LEVELED_LINE.test(l)).length >= sample.length * 0.3
  );
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
export function summarizeLogs(files: LogFile[], maxChars = 8000): string {
  const parts: string[] = [];

  for (const f of files) {
    const lines = linesOf(f);
    const leveled = isLeveled(lines);
    const isError = (line: string): boolean => {
      if (!leveled) return ERROR_LINE.test(line);
      // 带级别的日志只看级别；没有级别前缀的是上一条的续行，不单独算
      const m = LEVELED_LINE.exec(line);
      return !!m && ERROR_LEVEL.test(m[1] ?? '');
    };
    const blocks = new Map<string, ErrorBlock>();
    const picked = new Set<number>();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (!isError(line)) continue;
      const block = [line];
      const numbered = [`${i + 1}: ${clip(line)}`];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j] ?? '';
        const isFrame = STACK_FRAME.test(next);
        if (leveled) {
          // 续行：直到下一条带级别前缀的记录为止，最多带 MAX_CONTINUATION 行
          if (LEVELED_LINE.test(next)) break;
          if (j - i > MAX_CONTINUATION) {
            let rest = j;
            while (rest < lines.length && !LEVELED_LINE.test(lines[rest] ?? '')) rest++;
            numbered.push(`…（后续 ${rest - j} 行省略）`);
            j = rest;
            break;
          }
        } else if (!isFrame && !/^\s*Caused by:/.test(next) && !EXCEPTION_HEAD.test(next)) {
          break;
        }
        block.push(next);
        numbered.push(`${j + 1}: ${clip(next)}`);
        j++;
      }
      for (let k = i; k < j; k++) picked.add(k);
      const key = normalize(block.join('\n'));
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
        ...tail.map(({ l }) => clip(l)),
      );
    }
  }

  let summary = parts.join('\n');
  if (summary.length > maxChars) summary = `…（已截断，仅保留末尾）\n${summary.slice(-maxChars)}`;
  return summary;
}
