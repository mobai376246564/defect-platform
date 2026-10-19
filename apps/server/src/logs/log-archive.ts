import yauzl from 'yauzl';

export interface LogFile {
  name: string;
  text: string;
}

const MAX_ENTRY_BYTES = 30 * 1024 * 1024;
const TEXT_EXT = /\.(log|txt|json|out|err|trace)$/i;

/**
 * 把一个日志附件展开成若干文本文件：zip 解压出其中的文本日志，其它按 UTF-8 文本处理。
 * 加密日志（如 Mars xlog）需先解密，见方案 5.4 ④，此处不处理。
 */
export async function readLogArchive(fileName: string, data: Buffer): Promise<LogFile[]> {
  if (!/\.zip$/i.test(fileName)) return [{ name: fileName, text: data.toString('utf8') }];
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.fromBuffer(data, { lazyEntries: true }, (err, z) =>
      err || !z ? reject(err) : resolve(z),
    ),
  );
  const files: LogFile[] = [];
  await new Promise<void>((resolve, reject) => {
    zip.on('error', reject);
    zip.on('end', () => resolve());
    zip.on('entry', (entry: yauzl.Entry) => {
      const isDir = entry.fileName.endsWith('/');
      if (isDir || !TEXT_EXT.test(entry.fileName) || entry.uncompressedSize > MAX_ENTRY_BYTES) {
        zip.readEntry();
        return;
      }
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) return reject(err);
        const chunks: Buffer[] = [];
        stream.on('data', (c: Buffer) => chunks.push(c));
        stream.on('error', reject);
        stream.on('end', () => {
          files.push({ name: entry.fileName, text: Buffer.concat(chunks).toString('utf8') });
          zip.readEntry();
        });
      });
    });
    zip.readEntry();
  });
  return files;
}

export interface GrepMatch {
  file: string;
  line: number;
  text: string;
}

/** 在日志中检索，返回命中行及上下文（供 MCP grep_log 使用）。 */
export function grepLogs(
  files: LogFile[],
  pattern: RegExp,
  opts: { context: number; maxMatches: number },
): { matches: GrepMatch[][]; truncated: boolean } {
  const groups: GrepMatch[][] = [];
  let count = 0;
  for (const f of files) {
    const lines = f.text.split(/\r?\n/);
    let lastEnd = -1;
    for (let i = 0; i < lines.length; i++) {
      pattern.lastIndex = 0;
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
