export interface Mentionable {
  id: string;
  name: string;
  username?: string | null;
  email?: string | null;
}

/**
 * 从评论正文中找出被 @ 的成员：`@姓名`、`@账号` 或 `@邮箱`。
 * 中文常紧跟正文书写（如“@小王请看”），所以不要求 @ 后有分隔符，
 * 而是在每个 @ 处取能匹配上的最长姓名 / 邮箱，避免“小王”误命中“小王子”。
 */
export function extractMentions(body: string, members: Mentionable[]): string[] {
  const candidates = members
    .flatMap((m) => [
      { id: m.id, text: m.name },
      { id: m.id, text: (m.username ?? '').toLowerCase() },
      { id: m.id, text: (m.email ?? '').toLowerCase() },
    ])
    .filter((c) => c.text.length > 0)
    .sort((a, b) => b.text.length - a.text.length);
  const lower = body.toLowerCase();
  const found = new Set<string>();
  for (let i = lower.indexOf('@'); i >= 0; i = lower.indexOf('@', i + 1)) {
    // 邮箱中间的 @（如 a@b.com）不是提及
    if (i > 0 && /[\w.+-]/.test(body[i - 1]!)) continue;
    const hit = candidates.find((c) => lower.startsWith(c.text.toLowerCase(), i + 1));
    if (hit) found.add(hit.id);
  }
  return [...found];
}
