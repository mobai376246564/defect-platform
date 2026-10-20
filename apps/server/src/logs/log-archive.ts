import yauzl from 'yauzl';

export interface LogFile {
  name: string;
  text: string;
  /** 按行拆分的结果，第一次用到时生成并缓存（见 linesOf） */
  lines?: string[];
}

/** 单个文件、整个压缩包解压后的上限，以及最多处理的条目数：防止压缩炸弹把进程内存撑爆 */
const MAX_ENTRY_BYTES = 30 * 1024 * 1024;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_ENTRIES = 2000;
const TEXT_EXT = /\.(log|txt|json|out|err|trace)$/i;
/** 压缩包里有内容因超限没有展开时，追加一个说明文件，检索时能看到原因 */
export const SKIPPED_NOTE_NAME = '（未展开的内容）';

/** 日志按行拆分，结果缓存在对象上，grep / read 反复调用时不再重复拆分整份文本 */
export function linesOf(f: LogFile): string[] {
  f.lines ??= f.text.split(/\r?\n/);
  return f.lines;
}

/** 解码为文本，去掉开头的 UTF-8 BOM（Unity 等客户端日志常带） */
function decode(buf: Buffer): string {
  const text = buf.toString('utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * 把一个日志附件展开成若干文本文件：zip 解压出其中的文本日志，其它按 UTF-8 文本处理。
 * 加密日志（如 Mars xlog）需先解密，见方案 5.4 ④，此处不处理。
 */
export async function readLogArchive(fileName: string, data: Buffer): Promise<LogFile[]> {
  if (!/\.zip$/i.test(fileName)) return [{ name: fileName, text: decode(data) }];
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.fromBuffer(data, { lazyEntries: true }, (err, z) =>
      err || !z ? reject(err) : resolve(z),
    ),
  );
  const files: LogFile[] = [];
  const skipped: string[] = [];
  let total = 0;
  let entries = 0;
  await new Promise<void>((resolve, reject) => {
    const stop = () => {
      zip.close();
      resolve();
    };
    zip.on('error', reject);
    zip.on('end', () => resolve());
    zip.on('entry', (entry: yauzl.Entry) => {
      if (++entries > MAX_ENTRIES) {
        skipped.push(`条目超过 ${MAX_ENTRIES} 个，其余未处理`);
        return stop();
      }
      if (entry.fileName.endsWith('/') || !TEXT_EXT.test(entry.fileName)) {
        zip.readEntry();
        return;
      }
      if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
        skipped.push(`${entry.fileName}（超过 30 MB）`);
        zip.readEntry();
        return;
      }
      if (total + entry.uncompressedSize > MAX_TOTAL_BYTES) {
        skipped.push(`解压总量超过 200 MB，从 ${entry.fileName} 起未处理`);
        return stop();
      }
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) return reject(err);
        const chunks: Buffer[] = [];
        let size = 0;
        let tooBig = false;
        // 头信息里的大小可以伪造，读取时按实际字节数再检查一次
        stream.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_ENTRY_BYTES) {
            tooBig = true;
            stream.destroy();
            return;
          }
          chunks.push(c);
        });
        stream.on('error', (e) => {
          if (!tooBig) reject(e);
        });
        stream.on('close', () => {
          if (tooBig) skipped.push(`${entry.fileName}（超过 30 MB）`);
          else {
            total += size;
            files.push({ name: entry.fileName, text: decode(Buffer.concat(chunks)) });
          }
          zip.readEntry();
        });
      });
    });
    zip.readEntry();
  });
  if (skipped.length) {
    files.push({
      name: SKIPPED_NOTE_NAME,
      text: `以下内容因超过大小或数量限制没有展开，需要时用 download_attachments 下载原包：\n${skipped.join('\n')}`,
    });
  }
  return files;
}

export interface GrepMatch {
  file: string;
  line: number;
  text: string;
}

/**
 * 在日志中检索，返回命中行及上下文（供 MCP grep_log 使用）。
 * pattern 可以是普通正则，也可以是带 test 方法的匹配器（MCP 用线性时间的 RE2 引擎，防止恶意正则卡死服务）。
 */
export function grepLogs(
  files: LogFile[],
  pattern: RegExp | { test(line: string): boolean },
  opts: { context: number; maxMatches: number },
): { matches: GrepMatch[][]; truncated: boolean } {
  const groups: GrepMatch[][] = [];
  let count = 0;
  for (const f of files) {
    const lines = linesOf(f);
    let lastEnd = -1;
    for (let i = 0; i < lines.length; i++) {
      if (pattern instanceof RegExp) pattern.lastIndex = 0;
      if (!pattern.test(lines[i] ?? '')) continue;
      count++;
      if (count > opts.maxMatches) return { matches: groups, truncated: true };
      const start = Math.max(0, i - opts.context, lastEnd + 1);
      const end = Math.min(lines.length - 1, i + opts.context);
      const group: GrepMatch[] = [];
      for (let j = start; j <= end; j++)
        group.push({ file: f.name, line: j + 1, text: lines[j] ?? '' });
      // 与上一组重叠时合并，避免重复输出
      const prev = groups[groups.length - 1];
      if (prev && prev[0]?.file === f.name && start <= lastEnd + 1) prev.push(...group);
      else groups.push(group);
      lastEnd = end;
    }
  }
  return { matches: groups, truncated: false };
}
