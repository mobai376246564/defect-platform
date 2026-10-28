const TOKEN_KEY = 'defect.token';

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null): void {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      // 隐私模式等环境下 localStorage 不可用，仅本次会话有效
    }
  },
};

let onUnauthorized: (() => void) | undefined;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

/** 从服务端错误响应中提取给用户看的文字 */
export function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const b = body as { message?: unknown; missing?: string[]; issues?: unknown[] };
    const parts: string[] = [];
    if (typeof b.message === 'string') parts.push(b.message);
    else if (Array.isArray(b.message)) parts.push(b.message.join('；'));
    if (b.missing?.length) parts.push(`缺少：${b.missing.join('、')}`);
    if (Array.isArray(b.issues) && b.issues.length) {
      parts.push(
        b.issues
          .map((i) =>
            typeof i === 'string'
              ? i
              : `${(i as { path?: string }).path ?? ''} ${(i as { message?: string }).message ?? ''}`.trim(),
          )
          .join('；'),
      );
    }
    if (parts.length) return parts.join('：');
  }
  return fallback;
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, unknown> } = {},
): Promise<T> {
  const url = new URL(`/api/v1${path}`, window.location.origin);
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const token = tokenStore.get();
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body: unknown = text ? safeJson(text) : undefined;
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') onUnauthorized?.();
    throw new ApiError(res.status, errorMessage(body, `请求失败（${res.status}）`), body);
  }
  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
