import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

function run(args: string[], timeoutMs = 60_000): Promise<{ code: number; stderr: string }> {
  if (!ffmpegPath) return Promise.reject(new Error('当前平台没有可用的 ffmpeg'));
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath as unknown as string, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('ffmpeg 超时'));
    }, timeoutMs);
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stderr });
    });
  });
}

/** 读取视频时长（秒）。ffmpeg -i 在没有输出文件时会以非 0 退出，这里只解析 stderr。 */
export async function probeDurationSec(file: string): Promise<number> {
  const { stderr } = await run(['-hide_banner', '-i', file]);
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!m) throw new Error('无法识别视频时长，文件可能已损坏');
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** 截取某一时刻的一帧，输出最长边 1280 的 JPEG。 */
export async function extractFrame(file: string, atSec: number, out: string): Promise<void> {
  const { code, stderr } = await run([
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    atSec.toFixed(3),
    '-i',
    file,
    '-frames:v',
    '1',
    '-vf',
    "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))'",
    '-q:v',
    '4',
    '-y',
    out,
  ]);
  if (code !== 0) throw new Error(`抽帧失败：${stderr.slice(-500)}`);
}

/**
 * 计算抽帧时间点（毫秒）：全片均匀采样不超过 32 帧，标记时间点前后 5 秒每秒 1 帧。
 * 返回升序且去重（同一秒内只保留一帧）。
 */
export function planFrameTimes(
  durationSec: number,
  markedAtMs?: number | null,
): { tsMs: number; nearMark: boolean }[] {
  const plan = new Map<number, boolean>();
  // 恰好落在片尾的时间点取不到帧，留出 0.2 秒余量
  const last = Math.max(0, durationSec - 0.2);
  const interval = Math.max(1, durationSec / 32);
  for (let t = 0; t <= last; t += interval) plan.set(Math.round(t * 1000), false);
  if (markedAtMs != null) {
    const mark = markedAtMs / 1000;
    for (let t = Math.max(0, mark - 5); t <= Math.min(last, mark + 5); t += 1) {
      plan.set(Math.round(t * 1000), true);
    }
  }
  const sorted = [...plan.entries()].sort((a, b) => a[0] - b[0]);
  const out: { tsMs: number; nearMark: boolean }[] = [];
  for (const [tsMs, nearMark] of sorted) {
    const last = out[out.length - 1];
    if (last && tsMs - last.tsMs < 500) {
      last.nearMark ||= nearMark;
      continue;
    }
    out.push({ tsMs, nearMark });
  }
  return out.slice(0, 48);
}
