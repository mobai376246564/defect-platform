/**
 * 从分支名、提交信息、MR 标题中识别本项目的缺陷编号（方案 7.7）。
 * 支持 `fix(APP-12): …`、`fix/APP-12-xxx`、`bugfix-app-12` 等写法，大小写不敏感；
 * 只识别当前项目的标识，且前后不能紧跟字母数字，避免把 MYAPP-1、APP-12345 的一部分误判为编号。
 */
export function findDefectCodes(
  projectKey: string,
  ...texts: (string | null | undefined)[]
): string[] {
  const re = new RegExp(`(?<![A-Za-z0-9])${projectKey}-(\\d+)(?![0-9])`, 'gi');
  const codes = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const m of text.matchAll(re)) codes.add(`${projectKey}-${Number(m[1])}`);
  }
  return [...codes];
}
