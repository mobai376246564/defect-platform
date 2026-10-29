import { describe, expect, it } from 'vitest';
import { MAX_BYTES, addFiles, namePasted } from './attachment-files';

const file = (name: string, size = 10, type = '') =>
  Object.defineProperty(new File(['x'], name, { type }), 'size', { value: size });

describe('namePasted', () => {
  const now = new Date(2026, 9, 29, 9, 5, 7);

  it('gives clipboard screenshots a dated name and keeps real file names', () => {
    const [a, b] = namePasted(
      [new File(['x'], 'image.png', { type: 'image/png' }), new File(['y'], '登录页.jpg')],
      now,
    );
    expect(a!.name).toBe('粘贴截图-20261029-090507-1.png');
    expect(a!.type).toBe('image/png');
    expect(b!.name).toBe('登录页.jpg');
  });

  it('derives the extension from the image type when the name has none', () => {
    const [a] = namePasted([new File(['x'], 'blob', { type: 'image/jpeg' })], now);
    expect(a!.name).toBe('粘贴截图-20261029-090507.jpg');
  });
});

describe('addFiles', () => {
  it('skips unsupported or oversized files and keeps at most 10', () => {
    const current = Array.from({ length: 8 }, (_, i) => ({ file: file(`${i}.png`) }));
    const { files, rejected } = addFiles(current, [
      file('page.html'),
      file('big.mp4', MAX_BYTES + 1),
      file('a.png'),
      file('b.log'),
      file('c.jpg'),
    ]);
    expect(files.map((f) => f.file.name)).toEqual([
      ...current.map((f) => f.file.name),
      'a.png',
      'b.log',
    ]);
    expect(rejected).toEqual([
      'page.html（不支持的文件类型）',
      'big.mp4（超过 200 MB）',
      'c.jpg（最多 10 个）',
    ]);
  });
});
